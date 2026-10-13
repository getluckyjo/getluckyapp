/**
 * A card on the account profile, held by Stitch as a payment consent.
 *
 *   createConsentRequest   start one: Stitch returns the consent id (our
 *                          token from then on) and the hosted page URL
 *   consentStatus          what Stitch says about one, with the card's
 *                          last four digits for the label
 *   revokeConsent          the golfer removed the card
 *   initiateCardTransaction charge a granted consent for a stake
 *
 * The card number never touches us: Stitch's page takes it, with the
 * bank's 3-D Secure step, and all we keep is the consent id.
 */
import { log } from '@/lib/observability/log'
import { graphql, runInitiate, type WalletOutcome } from './api'
import type { StitchConfig } from './config'

const CONSENT_SCOPES = ['client_recurringpaymentconsentrequest']

const CREATE_CONSENT = `
mutation createConsentRequest($nonce: String!, $expireAt: Date) {
  paymentConsentRequestCreate(input: { nonce: $nonce, expireAt: $expireAt, paymentMethods: { card: { enabled: true } } }) { id url }
}`

/** How long the hosted page may be left open before the request expires on its own. */
export const CONSENT_REQUEST_TTL_MS = 60 * 60_000

export async function createConsentRequest(config: StitchConfig, input: { nonce: string; now?: Date }): Promise<{ id: string; url: string }> {
  const expireAt = new Date((input.now ?? new Date()).getTime() + CONSENT_REQUEST_TTL_MS).toISOString()
  const data = await graphql<{ paymentConsentRequestCreate: { id: string; url: string } }>(config, CONSENT_SCOPES, CREATE_CONSENT, { nonce: input.nonce, expireAt })
  const out = data.paymentConsentRequestCreate
  if (!out?.id || !out?.url) throw new Error('Stitch: consent request came back without an id or URL')
  log.info('stitch.consent.created', { consent_id: out.id })
  return { id: out.id, url: out.url }
}

/** The hosted page URL with our return leg appended; Stitch sends the golfer back there. */
export function consentRedirectUrl(url: string, returnUrl: string): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}redirect_uri=${encodeURIComponent(returnUrl)}`
}

export type ConsentState = 'granted' | 'pending' | 'expired' | 'revoked' | 'failed' | 'unknown'

export interface ConsentCard {
  last4: string | null
  network: string | null
  type: string | null
  issuer: string | null
}

const CONSENT_NODE = `
query consent($id: ID!) {
  node(id: $id) {
    ... on PaymentConsentRequest {
      id
      state { __typename }
      card { last4 network type issuer { name } }
    }
  }
}`

/** The consent's state as a word, from a PaymentConsent… typename or a webhook status. */
export function consentStateOf(value: string | null | undefined): ConsentState {
  const v = (value ?? '').toUpperCase().replace(/^PAYMENTCONSENT/, '')
  if (v === 'GRANTED') return 'granted'
  if (v === 'PENDING' || v === 'PROCESSING' || v === 'PAUSED') return 'pending'
  if (v === 'EXPIRED') return 'expired'
  if (v === 'REVOKED') return 'revoked'
  if (v === 'FAILED' || v === 'CANCELLED') return 'failed'
  return 'unknown'
}

export function consentCardOf(card: unknown): ConsentCard | null {
  if (!card || typeof card !== 'object') return null
  const c = card as { last4?: unknown; network?: unknown; type?: unknown; issuer?: { name?: unknown } | null }
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null)
  return { last4: str(c.last4), network: str(c.network), type: str(c.type), issuer: str(c.issuer?.name) }
}

/** "Visa •••• 1234", or what there is. At most 40 characters (payment_cards.label). */
export function cardLabel(card: ConsentCard | null): string {
  if (!card) return 'Saved card'
  const network = card.network ? card.network.charAt(0).toUpperCase() + card.network.slice(1).toLowerCase() : 'Card'
  return (card.last4 ? `${network} •••• ${card.last4}` : network).slice(0, 40)
}

export async function consentStatus(config: StitchConfig, id: string): Promise<{ state: ConsentState; card: ConsentCard | null }> {
  const data = await graphql<{ node: { id?: string; state?: { __typename?: string } | null; card?: unknown } | null }>(config, CONSENT_SCOPES, CONSENT_NODE, { id })
  if (!data.node) return { state: 'unknown', card: null }
  return { state: consentStateOf(data.node.state?.__typename), card: consentCardOf(data.node.card) }
}

const REVOKE_CONSENT = `
mutation revokeConsentRequest($id: ID!, $reason: String!) {
  paymentConsentRequestRevoke(consentRequestId: $id, reason: $reason) { id }
}`

export async function revokeConsent(config: StitchConfig, id: string, reason = 'Removed by the account holder'): Promise<void> {
  await graphql<{ paymentConsentRequestRevoke: { id: string } | null }>(config, CONSENT_SCOPES, REVOKE_CONSENT, { id, reason })
  log.info('stitch.consent.revoked', { consent_id: id })
}

export interface CardChargeInput {
  /** The consent id. */
  token: string
  amountCents: number
  reference: string
  nonce: string
  payer: { id: string; email?: string | null; name?: string | null; ip?: string | null; createdAt?: string | null }
}

/**
 * Charge a granted consent. Stitch decides on 3-D Secure for the client as
 * a whole; when the bank wants the step the answer is pending with the
 * bank's URL, the same as a wallet.
 */
export async function initiateCardTransaction(config: StitchConfig, input: CardChargeInput): Promise<WalletOutcome> {
  const variables = {
    input: {
      amount: { quantity: (input.amountCents / 100).toFixed(2), currency: 'ZAR' },
      nonce: input.nonce,
      externalReference: input.reference,
      token: input.token,
      payerInformation: {
        payerId: input.payer.id,
        ...(input.payer.email ? { email: input.payer.email } : {}),
        ...(input.payer.name ? { fullName: input.payer.name } : {}),
        ...(input.payer.createdAt ? { accountCreatedDate: input.payer.createdAt } : {}),
      },
      ...(input.payer.ip ? { deviceInformation: { ip: { address: input.payer.ip } } } : {}),
      metadata: { product: 'hole_in_one_entry', reference: input.reference, method: 'card_on_file' },
    },
  }
  return runInitiate(config, variables, { reference: input.reference, wallet: 'card', amount_cents: input.amountCents })
}
