/**
 * The Stitch GraphQL API, from the server only.
 *
 *   clientToken              OAuth client-credentials token, cached per scope
 *   validateApplePayMerchant the Apple Pay merchant session Safari asks for
 *   initiateWalletTransaction charge an Apple Pay or Google Pay token
 *   findTransactionByReference what Stitch holds for one of our references
 *
 * Every call is logged by event name; no token, secret or card data is ever
 * logged. Errors from Stitch come back as thrown Errors with the GraphQL
 * message; the routes decide what the golfer sees.
 */
import { log } from '@/lib/observability/log'
import type { StitchConfig } from './config'

export type WalletKind = 'apple_pay' | 'google_pay'

export type WalletOutcome =
  | { state: 'success'; id: string }
  | { state: 'pending'; id: string; interactionUrl: string | null; reason: string | null }
  | { state: 'failure'; id: string | null; reason: string | null; description: string | null }

interface TokenEntry { token: string; expiresAt: number }
const tokenCache = new Map<string, TokenEntry>()

/** For tests: forget cached tokens. */
export function resetStitchTokenCache(): void {
  tokenCache.clear()
}

/** A client token for the given scopes, from the cache while it has a minute left. */
export async function clientToken(config: StitchConfig, scopes: string[], now: () => number = Date.now): Promise<string> {
  const key = `${config.clientId}|${scopes.join(' ')}`
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt - 60_000 > now()) return cached.token

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    audience: config.tokenUrl,
    scope: scopes.join(' '),
  })
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  })
  const json = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!res.ok || !json.access_token) {
    log.warn('stitch.token.refused', { status: res.status, error: json.error ?? null, description: json.error_description ?? null, scopes })
    throw new Error(`Stitch token: ${json.error ?? res.status}${json.error_description ? ` (${json.error_description})` : ''}`)
  }
  const ttl = Math.max(60, Number(json.expires_in) || 3600) * 1000
  tokenCache.set(key, { token: json.access_token, expiresAt: now() + ttl })
  return json.access_token
}

interface GraphqlResponse<T> { data?: T; errors?: { message: string; extensions?: Record<string, unknown> }[] }

export async function graphql<T>(config: StitchConfig, scopes: string[], query: string, variables: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
  const token = await clientToken(config, scopes)
  const res = await fetch(config.graphqlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const json = await res.json().catch(() => ({})) as GraphqlResponse<T>
  if (!res.ok || json.errors?.length || !json.data) {
    const message = json.errors?.map(e => e.message).join('; ') || `HTTP ${res.status}`
    const code = json.errors?.[0]?.extensions?.code
    log.warn('stitch.graphql.error', { status: res.status, message, code: typeof code === 'string' ? code : null })
    throw new Error(`Stitch: ${message}`)
  }
  return json.data
}

// ── Apple Pay merchant validation ─────────────────────────────────────────

const VALIDATE_APPLE_PAY = `
mutation validateApplePayMerchant($input: ValidateApplePayMerchantInput!) {
  validateApplePayMerchant(input: $input) { __typename sessionData }
}`

/**
 * Safari hands the page a validation URL when the Apple Pay sheet opens; the
 * merchant (us, through Stitch) must turn it into a session. The result is
 * the opaque session object Safari wants back, parsed.
 */
export async function validateApplePayMerchant(config: StitchConfig, input: { validationUrl: string; initiativeContext: string }): Promise<unknown> {
  const data = await graphql<{ validateApplePayMerchant: { sessionData: string | Record<string, unknown> } }>(config, ['transaction_initiate'], VALIDATE_APPLE_PAY, {
    input: {
      merchantIdentifier: config.appleMerchantIdentifier,
      validationUrl: input.validationUrl,
      displayName: config.displayName,
      initiative: 'web',
      initiativeContext: input.initiativeContext,
    },
  })
  const raw = data.validateApplePayMerchant.sessionData
  log.info('stitch.applepay.validated', { host: input.initiativeContext })
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

// ── Wallet transactions ───────────────────────────────────────────────────

const INITIATE = `
mutation initiateTransaction($input: TransactionInitiateInput!) {
  initiateTransaction(input: $input) {
    __typename
    id
    ... on ApplePayTransaction { interactionUrl state { __typename ... on TransactionPending { reason } ... on TransactionFailure { reason reasonDescription } } }
    ... on GooglePayTransaction { interactionUrl state { __typename ... on TransactionPending { reason } ... on TransactionFailure { reason reasonDescription } } }
    ... on CardTransaction { interactionUrl state { __typename ... on TransactionPending { reason } ... on TransactionFailure { reason reasonDescription } } }
  }
}`

export interface WalletChargeInput {
  wallet: WalletKind
  /** The provider token, already base64-encoded as Stitch wants it. */
  token: string
  /** The Stitch client SDK's device fingerprint, base64; optional. */
  fingerprint: string | null
  amountCents: number
  /** Our ledger reference (gl_…). */
  reference: string
  /** Unique per attempt. */
  nonce: string
  payer: { id: string; email?: string | null; name?: string | null; ip?: string | null; createdAt?: string | null }
  /** What the wallet said about the card, for Stitch's record; all optional. */
  meta?: { network?: string | null; displayName?: string | null; type?: string | null }
}

interface InitiateData {
  initiateTransaction: {
    __typename: string
    id: string
    interactionUrl?: string | null
    state?: { __typename: string; reason?: string | null; reasonDescription?: string | null }
  }
}

/** Charge a wallet token. The amount is sent in rand with two decimals, exactly what the sheet showed. */
export async function initiateWalletTransaction(config: StitchConfig, input: WalletChargeInput): Promise<WalletOutcome> {
  const quantity = (input.amountCents / 100).toFixed(2)
  const method = input.wallet === 'apple_pay'
    ? { applePay: { ...(input.meta?.network ? { network: mapNetwork(input.meta.network) } : {}), ...(input.meta?.displayName ? { displayName: input.meta.displayName } : {}), ...(input.meta?.type ? { type: input.meta.type } : {}) } }
    : { googlePay: { ...(input.meta?.network ? { network: mapNetwork(input.meta.network) } : {}) } }
  const variables = {
    input: {
      amount: { quantity, currency: 'ZAR' },
      nonce: input.nonce,
      externalReference: input.reference,
      token: input.token,
      paymentMethods: method,
      payerInformation: {
        payerId: input.payer.id,
        ...(input.payer.email ? { email: input.payer.email } : {}),
        ...(input.payer.name ? { fullName: input.payer.name } : {}),
        ...(input.payer.createdAt ? { accountCreatedDate: input.payer.createdAt } : {}),
      },
      ...(input.fingerprint || input.payer.ip
        ? { deviceInformation: { ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}), ...(input.payer.ip ? { ip: { address: input.payer.ip } } : {}) } }
        : {}),
      metadata: { product: 'hole_in_one_entry', reference: input.reference },
    },
  }
  return runInitiate(config, variables, { reference: input.reference, wallet: input.wallet, amount_cents: input.amountCents })
}

/** Send an initiateTransaction and map its answer; shared by the wallets and the card on file. */
export async function runInitiate(config: StitchConfig, variables: Record<string, unknown>, fields: { reference: string; wallet: string; amount_cents: number }): Promise<WalletOutcome> {
  let data: InitiateData
  try {
    data = await graphql<InitiateData>(config, ['transaction_initiate'], INITIATE, variables)
  } catch (err) {
    log.warn('stitch.wallet.initiate_error', { ...fields, error: err instanceof Error ? err.message : String(err) })
    throw err
  }
  const tx = data.initiateTransaction
  const typename = tx.state?.__typename ?? ''
  const outcome: WalletOutcome =
    typename === 'TransactionSuccess' ? { state: 'success', id: tx.id }
    : typename === 'TransactionPending' ? { state: 'pending', id: tx.id, interactionUrl: tx.interactionUrl ?? null, reason: tx.state?.reason ?? null }
    : { state: 'failure', id: tx.id ?? null, reason: tx.state?.reason ?? null, description: tx.state?.reasonDescription ?? null }
  log.info('stitch.wallet.initiated', { ...fields, state: outcome.state, reason: 'reason' in outcome ? outcome.reason : null, stitch_id: tx.id ?? null })
  return outcome
}

/** Apple and Google say "Visa"/"MasterCard"/"VISA"; Stitch's enum is uppercase. */
function mapNetwork(network: string): string {
  const n = network.trim().toUpperCase().replace(/\s+/g, '')
  if (n === 'MASTERCARD' || n === 'MASTER') return 'MASTERCARD'
  if (n === 'VISA') return 'VISA'
  if (n === 'AMEX' || n === 'AMERICANEXPRESS') return 'AMEX'
  return n
}

// ── Lookups ───────────────────────────────────────────────────────────────

const BY_REFERENCE = `
query getTransactionByExternalReference($externalRef: String) {
  client {
    transactions(filter: { externalReference: { eq: $externalRef } }) {
      edges { node { ... on PaymentTransaction { __typename id externalReference amount state { __typename ... on TransactionFailure { reason } ... on TransactionPending { reason } } } } }
    }
  }
}`

export type TransactionLookup =
  | { found: true; id: string; state: 'success' | 'pending' | 'failure'; amountCents: number | null; reason: string | null }
  | { found: false }

/** What Stitch holds for one of our references; the newest successful one wins when there are several. */
export async function findTransactionByReference(config: StitchConfig, reference: string): Promise<TransactionLookup> {
  const data = await graphql<{ client: { transactions: { edges: { node: { id: string; externalReference: string; amount?: { quantity?: string | number } | string; state?: { __typename: string; reason?: string | null } } }[] } } }>(
    config, ['transaction_initiate'], BY_REFERENCE, { externalRef: reference },
  )
  const nodes = (data.client?.transactions?.edges ?? []).map(e => e.node).filter(n => n && n.externalReference === reference)
  if (nodes.length === 0) return { found: false }
  const pick = nodes.find(n => n.state?.__typename === 'TransactionSuccess') ?? nodes[nodes.length - 1]
  const typename = pick.state?.__typename ?? ''
  const state = typename === 'TransactionSuccess' ? 'success' : typename === 'TransactionPending' ? 'pending' : 'failure'
  return { found: true, id: pick.id, state, amountCents: amountToCents(pick.amount), reason: pick.state?.reason ?? null }
}

/** Stitch amounts arrive as { quantity, currency } or a "ZAR 50.00" string. */
export function amountToCents(amount: unknown): number | null {
  if (amount && typeof amount === 'object' && 'quantity' in amount) {
    const q = Number((amount as { quantity: unknown }).quantity)
    return Number.isFinite(q) ? Math.round(q * 100) : null
  }
  if (typeof amount === 'string') {
    const m = amount.match(/(-?\d+(?:\.\d+)?)/)
    return m ? Math.round(Number(m[1]) * 100) : null
  }
  if (typeof amount === 'number') return Math.round(amount * 100)
  return null
}
