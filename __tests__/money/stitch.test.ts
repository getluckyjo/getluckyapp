/**
 * Apple Pay and Google Pay through Stitch (migration 045).
 *
 * The config guard, the GraphQL client (token cache, the initiate mutation
 * and how its answer maps), the Svix signature check, and the three routes:
 * /api/payments/wallet/validate, /api/payments/wallet/charge and
 * /api/payments/stitch/webhook, plus the reconciliation. Money invariants,
 * the same as the saved card: the ledger row exists before Stitch is asked;
 * a refusal leaves 'failed' and no bet; a success leaves 'complete' and a
 * bet on the hole the golfer chose; no answer leaves 'unknown', never
 * 'failed'; the webhook writes once and only ever moves a row forward.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { FakeDb, createFakeClient, jsonRequest, USER_A, COURSE_ID, HOLE_ID, type FakeUser } from '../helpers/fake-supabase'
import { resolveStitchConfig, siteHost, stitchEnabled } from '@/lib/stitch/config'
import { amountToCents, clientToken, initiateWalletTransaction, resetStitchTokenCache } from '@/lib/stitch/api'
import { verifySvixSignature, parseTransactionEvent } from '@/lib/stitch/webhook'
import { settleStitchTransaction } from '@/lib/stitch/settle'
import { reconcileStitchPayments } from '@/lib/stitch/reconcile'
import { reconcileUnknownPayments } from '@/lib/payfast/reconcile'
import { applePayRequest, encodeWalletToken, googlePayRequest, threeDsReturnUrl, walletPublicConfig } from '@/lib/stitch/public'
import { POST as charge } from '@/app/api/payments/wallet/charge/route'
import { POST as validate } from '@/app/api/payments/wallet/validate/route'
import { POST as webhook } from '@/app/api/payments/stitch/webhook/route'
import { GET as domainFile } from '@/app/.well-known/apple-developer-merchantid-domain-association/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb
const SECRET_B64 = Buffer.from('unit-test-webhook-secret-32-bytes!!').toString('base64')
const WEBHOOK_SECRET = `whsec_${SECRET_B64}`
const TOKEN = 'J2V4YW1wbGVQYXltZW50TWV0aG9kVG9rZW4n'

function env(over: Record<string, string | undefined> = {}) {
  vi.unstubAllEnvs()
  const base: Record<string, string | undefined> = {
    STITCH_CLIENT_ID: 'test-abc123', STITCH_CLIENT_SECRET: 'shh', STITCH_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STITCH_APPLE_MERCHANT_IDENTIFIER: 'merchant.money.stitch.getlucky',
    NEXT_PUBLIC_SITE_URL: 'https://preview.example.com', VERCEL_ENV: 'preview', ...over,
  }
  for (const [k, v] of Object.entries(base)) if (v !== undefined) vi.stubEnv(k, v)
}
function asUser(user: FakeUser | null) {
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user }))
}
function seed(opts: { verified?: boolean } = {}) {
  db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek', is_partner: true })
  db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 4, par: 3, distance_metres: 165, is_active: true })
  db.seed('profiles', { id: USER_A.id, age_verified_at: opts.verified === false ? null : '2026-01-01T00:00:00Z', total_attempts: 0 })
}

type Reply = { status?: number; json: unknown }
/** A fetch that answers the token endpoint, then each GraphQL call in order. */
function stitchFetch(graphqlReplies: (Reply | Error)[]) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = []
  let i = 0
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>))
    const rawBody = String(init.body)
    const body = rawBody.startsWith('{') ? JSON.parse(rawBody) : Object.fromEntries(new URLSearchParams(rawBody))
    calls.push({ url, body, headers })
    if (url.endsWith('/connect/token')) return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer' }), { status: 200 })
    const reply = graphqlReplies[i++] ?? graphqlReplies[graphqlReplies.length - 1]
    if (reply instanceof Error) throw reply
    return new Response(JSON.stringify(reply.json), { status: reply.status ?? 200 })
  })
  return Object.assign(fn, { calls })
}
const initiated = (state: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ json: { data: { initiateTransaction: { __typename: 'ApplePayTransaction', id: 'tx-1', interactionUrl: null, state, ...extra } } } })

const post = (body: unknown) => charge(jsonRequest('http://x/api/payments/wallet/charge', body) as never)
const good = { tier: 'tier_1', courseId: COURSE_ID, holeId: HOLE_ID, wallet: 'apple_pay', token: TOKEN, card: { network: 'Visa', displayName: 'Visa 1234', type: 'credit' } }

function signed(body: unknown, opts: { secret?: string; id?: string; ts?: number } = {}) {
  const raw = JSON.stringify(body)
  const id = opts.id ?? `msg_${Math.random().toString(36).slice(2)}`
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000))
  const key = Buffer.from((opts.secret ?? WEBHOOK_SECRET).replace(/^whsec_/, ''), 'base64')
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64')
  return new Request('http://x/api/payments/stitch/webhook', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` } })
}
const txEvent = (data: Record<string, unknown>) => ({ type: 'transaction', id: 'evt_1', datetime: '2026-10-13T10:00:00Z', data: { id: 'tx-9', type: 'applePay', ...data } })

beforeEach(() => {
  db = new FakeDb()
  env()
  resetStitchTokenCache()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.stubGlobal('fetch', stitchFetch([initiated({ __typename: 'TransactionSuccess' })]))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('config', () => {
  it('is off without a client id and secret; on with both', () => {
    expect(stitchEnabled({})).toBe(false)
    expect(stitchEnabled({ STITCH_CLIENT_ID: 'x', STITCH_CLIENT_SECRET: 'y' })).toBe(true)
    expect(resolveStitchConfig({}).ok).toBe(false)
  })
  it('resolves on a preview with a test client and no webhook secret', () => {
    const r = resolveStitchConfig({ STITCH_CLIENT_ID: 'test-abc', STITCH_CLIENT_SECRET: 's', STITCH_APPLE_MERCHANT_IDENTIFIER: 'merchant.x', VERCEL_ENV: 'preview' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.siteUrl).toBe('http://localhost:3000')
      expect(r.config.webhookSecret).toBeNull()
      expect(siteHost(r.config)).toBe('localhost')
    }
  })
  it('refuses a test client, a missing site URL and a missing webhook secret in production', () => {
    const r = resolveStitchConfig({ STITCH_CLIENT_ID: 'test-abc', STITCH_CLIENT_SECRET: 's', STITCH_APPLE_MERCHANT_IDENTIFIER: 'merchant.x', VERCEL_ENV: 'production' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/test client/)
      expect(r.reason).toMatch(/NEXT_PUBLIC_SITE_URL/)
      expect(r.reason).toMatch(/STITCH_WEBHOOK_SECRET/)
    }
    const ok = resolveStitchConfig({ STITCH_CLIENT_ID: 'live-abc', STITCH_CLIENT_SECRET: 's', STITCH_APPLE_MERCHANT_IDENTIFIER: 'merchant.x', STITCH_WEBHOOK_SECRET: 'whsec_x', NEXT_PUBLIC_SITE_URL: 'https://www.getluckyholeinone.com/', VERCEL_ENV: 'production' })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(siteHost(ok.config)).toBe('www.getluckyholeinone.com')
  })
})

describe('GraphQL client', () => {
  const cfg = () => { const r = resolveStitchConfig(); if (!r.ok) throw new Error(r.reason); return r.config }

  it('asks for a client-credentials token once and reuses it until it is about to expire', async () => {
    const f = stitchFetch([])
    vi.stubGlobal('fetch', f)
    let now = 1_000_000
    const clock = () => now
    expect(await clientToken(cfg(), ['transaction_initiate'], clock)).toBe('tok-1')
    expect(await clientToken(cfg(), ['transaction_initiate'], clock)).toBe('tok-1')
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].url).toBe('https://secure.stitch.money/connect/token')
    expect(f.calls[0].body).toEqual({ grant_type: 'client_credentials', client_id: 'test-abc123', client_secret: 'shh', audience: 'https://secure.stitch.money/connect/token', scope: 'transaction_initiate' })
    now += 3600_000 - 30_000 // inside the last minute
    await clientToken(cfg(), ['transaction_initiate'], clock)
    expect(f.calls).toHaveLength(2)
  })

  it('sends the wallet charge as Stitch wants it: rand with two decimals, our reference, the token, the payer', async () => {
    const f = stitchFetch([initiated({ __typename: 'TransactionSuccess' })])
    vi.stubGlobal('fetch', f)
    const out = await initiateWalletTransaction(cfg(), {
      wallet: 'apple_pay', token: TOKEN, fingerprint: 'fp', amountCents: 5000, reference: 'gl_1', nonce: 'n1',
      payer: { id: USER_A.id, email: 'a@example.com', name: 'Alice Ace', ip: '1.2.3.4' }, meta: { network: 'Visa', displayName: 'Visa 1234', type: 'credit' },
    })
    expect(out).toEqual({ state: 'success', id: 'tx-1' })
    const call = f.calls[1]
    expect(call.url).toBe('https://api.stitch.money/graphql')
    expect(call.headers.Authorization).toBe('Bearer tok-1')
    const { variables } = call.body as { variables: { input: Record<string, unknown> } }
    expect(variables.input).toMatchObject({
      amount: { quantity: '50.00', currency: 'ZAR' },
      nonce: 'n1', externalReference: 'gl_1', token: TOKEN,
      paymentMethods: { applePay: { network: 'VISA', displayName: 'Visa 1234', type: 'credit' } },
      payerInformation: { payerId: USER_A.id, email: 'a@example.com', fullName: 'Alice Ace' },
      deviceInformation: { fingerprint: 'fp', ip: { address: '1.2.3.4' } },
    })
  })

  it('maps pending (with its interaction URL) and failure answers; a GraphQL error throws', async () => {
    vi.stubGlobal('fetch', stitchFetch([
      initiated({ __typename: 'TransactionPending', reason: 'ThreeDSecureRequired' }, { interactionUrl: 'https://3ds.stitch.money/x' }),
      initiated({ __typename: 'TransactionFailure', reason: 'InsufficientFunds', reasonDescription: 'Insufficient funds' }),
      { json: { errors: [{ message: 'invalidTransactionError: amount mismatch', extensions: { code: 'BAD_USER_INPUT' } }] } },
    ]))
    const base = { wallet: 'google_pay' as const, token: TOKEN, fingerprint: null, amountCents: 5000, reference: 'gl_2', nonce: 'n', payer: { id: USER_A.id } }
    expect(await initiateWalletTransaction(cfg(), base)).toEqual({ state: 'pending', id: 'tx-1', interactionUrl: 'https://3ds.stitch.money/x', reason: 'ThreeDSecureRequired' })
    expect(await initiateWalletTransaction(cfg(), base)).toEqual({ state: 'failure', id: 'tx-1', reason: 'InsufficientFunds', description: 'Insufficient funds' })
    await expect(initiateWalletTransaction(cfg(), base)).rejects.toThrow(/amount mismatch/)
  })

  it('reads amounts in either shape', () => {
    expect(amountToCents({ quantity: '50.00', currency: 'ZAR' })).toBe(5000)
    expect(amountToCents({ quantity: 250 })).toBe(25000)
    expect(amountToCents('ZAR 50.00')).toBe(5000)
    expect(amountToCents(null)).toBeNull()
  })
})

describe('Svix signature', () => {
  const body = '{"type":"transaction"}'
  const sign = (id: string, ts: string, secret = WEBHOOK_SECRET) => createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64')
  const now = 1_760_000_000_000

  it('accepts a fresh, correctly signed delivery, including a rotated-secret header with two signatures', () => {
    const ts = String(Math.floor(now / 1000))
    expect(verifySvixSignature(WEBHOOK_SECRET, { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': `v1,${sign('msg_1', ts)}` }, body, now)).toEqual({ ok: true, id: 'msg_1' })
    const other = `whsec_${Buffer.from('another-secret').toString('base64')}`
    expect(verifySvixSignature(WEBHOOK_SECRET, { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': `v1,${sign('msg_1', ts, other)} v1,${sign('msg_1', ts)}` }, body, now).ok).toBe(true)
  })
  it('refuses a missing header, a stale timestamp, a wrong secret and a tampered body', () => {
    const ts = String(Math.floor(now / 1000))
    expect(verifySvixSignature(WEBHOOK_SECRET, { 'svix-id': 'msg_1', 'svix-timestamp': ts }, body, now)).toEqual({ ok: false, reason: 'missing_headers' })
    const old = String(Math.floor(now / 1000) - 6 * 60)
    expect(verifySvixSignature(WEBHOOK_SECRET, { 'svix-id': 'msg_1', 'svix-timestamp': old, 'svix-signature': `v1,${sign('msg_1', old)}` }, body, now)).toEqual({ ok: false, reason: 'bad_timestamp' })
    expect(verifySvixSignature(`whsec_${Buffer.from('nope').toString('base64')}`, { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': `v1,${sign('msg_1', ts)}` }, body, now)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifySvixSignature(WEBHOOK_SECRET, { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': `v1,${sign('msg_1', ts)}` }, body + ' ', now)).toEqual({ ok: false, reason: 'bad_signature' })
  })
  it('parses only transaction events with an id and a status', () => {
    expect(parseTransactionEvent(txEvent({ status: 'SUCCESS' }))).not.toBeNull()
    expect(parseTransactionEvent({ type: 'payment-consent-request', id: 'e', data: { id: 'c', status: 'GRANTED' } })).toBeNull()
    expect(parseTransactionEvent({ type: 'transaction', id: 'e', data: { id: 'x' } })).toBeNull()
    expect(parseTransactionEvent('nope')).toBeNull()
  })
})

describe('POST /api/payments/wallet/charge', () => {
  it('503 WALLET_UNAVAILABLE when Stitch is not configured; 401 without a session; 400 on a bad body', async () => {
    env({ STITCH_CLIENT_ID: undefined })
    asUser(USER_A); seed()
    const off = await post(good)
    expect(off.status).toBe(503)
    expect((await off.json()).code).toBe('WALLET_UNAVAILABLE')
    env()
    asUser(null)
    expect((await post(good)).status).toBe(401)
    asUser(USER_A)
    expect((await post({ ...good, wallet: 'samsung_pay' })).status).toBe(400)
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })

  it('writes the ledger row first (provider stitch), charges once, completes it and grants the bet on the chosen hole', async () => {
    asUser(USER_A); seed()
    const f = stitchFetch([initiated({ __typename: 'TransactionSuccess' })])
    vi.stubGlobal('fetch', f)
    const res = await post(good)
    expect(res.status).toBe(200)
    const { betId, m_payment_id } = await res.json()
    expect(m_payment_id).toMatch(/^gl_/)
    expect(f.calls.map(c => c.url)).toEqual(['https://secure.stitch.money/connect/token', 'https://api.stitch.money/graphql'])
    const { variables } = f.calls[1].body as { variables: { input: Record<string, unknown> } }
    expect(variables.input).toMatchObject({ amount: { quantity: '50.00', currency: 'ZAR' }, externalReference: m_payment_id, token: TOKEN })
    expect(variables.input.nonce).toBeTruthy()

    const [row] = db.rows('payfast_payments')
    expect(row).toMatchObject({ m_payment_id, user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', amount_cents: 5000, status: 'complete', provider: 'stitch', provider_ref: 'tx-1', bet_id: betId })
    expect((row.raw_payload as { wallet: string }).wallet).toBe('apple_pay')
    expect(JSON.stringify(row.raw_payload)).not.toContain(TOKEN)
    const bet = db.find('bets', b => b.id === betId)!
    expect(bet).toMatchObject({ user_id: USER_A.id, hole_id: HOLE_ID, tier: 'tier_1', stake_pence: 5000, status: 'active', payment_intent_id: m_payment_id })
  })

  it('402 WALLET_DECLINED when Stitch refuses: the row is failed and no bet exists', async () => {
    asUser(USER_A); seed()
    vi.stubGlobal('fetch', stitchFetch([initiated({ __typename: 'TransactionFailure', reason: 'InsufficientFunds', reasonDescription: 'Insufficient funds' })]))
    const res = await post({ ...good, wallet: 'google_pay' })
    expect(res.status).toBe(402)
    expect((await res.json()).code).toBe('WALLET_DECLINED')
    expect(db.rows('payfast_payments')[0]).toMatchObject({ status: 'failed', provider: 'stitch', provider_ref: 'tx-1', hole_id: HOLE_ID })
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('202 THREE_DS with the interaction URL when the bank wants a step: the row stays pending for the webhook', async () => {
    asUser(USER_A); seed()
    vi.stubGlobal('fetch', stitchFetch([initiated({ __typename: 'TransactionPending', reason: 'ThreeDSecureRequired' }, { interactionUrl: 'https://3ds.stitch.money/x' })]))
    const res = await post({ ...good, wallet: 'google_pay' })
    expect(res.status).toBe(202)
    const data = await res.json()
    expect(data).toMatchObject({ code: 'THREE_DS', interactionUrl: 'https://3ds.stitch.money/x' })
    expect(db.rows('payfast_payments')[0]).toMatchObject({ m_payment_id: data.m_payment_id, status: 'pending', provider_ref: 'tx-1' })
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('409 CHARGE_UNKNOWN when Stitch gives no answer: the row is unknown (never failed) and no bet', async () => {
    asUser(USER_A); seed()
    vi.stubGlobal('fetch', stitchFetch([new Error('fetch failed: timeout')]))
    const res = await post(good)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.code).toBe('CHARGE_UNKNOWN')
    expect(db.rows('payfast_payments')[0]).toMatchObject({ m_payment_id: data.m_payment_id, status: 'unknown', provider: 'stitch' })
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('409 AGE_NOT_VERIFIED when paid but the golfer is not verified: the row is complete, no bet, the reference is returned', async () => {
    asUser(USER_A); seed({ verified: false })
    const res = await post(good)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.code).toBe('AGE_NOT_VERIFIED')
    expect(data.m_payment_id).toMatch(/^gl_/)
    expect(db.rows('payfast_payments')[0].status).toBe('complete')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('refuses a closed hole before any ledger row or charge', async () => {
    asUser(USER_A); seed()
    db.rows('holes')[0].is_active = false
    const f = stitchFetch([])
    vi.stubGlobal('fetch', f)
    const res = await post(good)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(db.rows('payfast_payments')).toHaveLength(0)
    expect(f.calls).toHaveLength(0)
  })
})

describe('POST /api/payments/wallet/validate', () => {
  const call = (body: unknown) => validate(jsonRequest('http://x/api/payments/wallet/validate', body) as never)
  it('401 without a session; 400 for another host or a non-Apple URL; otherwise the merchant session from Stitch', async () => {
    asUser(null)
    expect((await call({ validationUrl: 'https://apple-pay-gateway.apple.com/paymentservices/startSession', initiativeContext: 'preview.example.com' })).status).toBe(401)
    asUser(USER_A); seed()
    expect((await call({ validationUrl: 'https://apple-pay-gateway.apple.com/paymentservices/startSession', initiativeContext: 'evil.example.com' })).status).toBe(400)
    expect((await call({ validationUrl: 'https://evil.example.com/startSession', initiativeContext: 'preview.example.com' })).status).toBe(400)
    const f = stitchFetch([{ json: { data: { validateApplePayMerchant: { __typename: 'ValidateApplePayMerchantResult', sessionData: JSON.stringify({ merchantSessionIdentifier: 'ms_1', nonce: 'n' }) } } } }])
    vi.stubGlobal('fetch', f)
    const res = await call({ validationUrl: 'https://apple-pay-gateway.apple.com/paymentservices/startSession', initiativeContext: 'Preview.Example.com' })
    expect(res.status).toBe(200)
    expect((await res.json()).session).toEqual({ merchantSessionIdentifier: 'ms_1', nonce: 'n' })
    const { variables } = f.calls[1].body as { variables: { input: Record<string, unknown> } }
    expect(variables.input).toEqual({ merchantIdentifier: 'merchant.money.stitch.getlucky', validationUrl: 'https://apple-pay-gateway.apple.com/paymentservices/startSession', displayName: 'Get Lucky Golf', initiative: 'web', initiativeContext: 'preview.example.com' })
  })
})

describe('POST /api/payments/stitch/webhook', () => {
  const ledger = (status: string, over: Record<string, unknown> = {}) =>
    db.seed('payfast_payments', { m_payment_id: 'gl_w1', user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', amount_cents: 5000, status, provider: 'stitch', raw_payload: { source: 'wallet', wallet: 'google_pay' }, created_at: '2026-10-13T09:00:00Z', ...over })[0]

  it('503 without a webhook secret; 401 on a bad signature or a stale timestamp; nothing is written', async () => {
    seed(); ledger('pending')
    env({ STITCH_WEBHOOK_SECRET: undefined })
    expect((await webhook(signed(txEvent({ externalReference: 'gl_w1', status: 'SUCCESS' })) as never)).status).toBe(503)
    env()
    expect((await webhook(signed(txEvent({ externalReference: 'gl_w1', status: 'SUCCESS' }), { secret: `whsec_${Buffer.from('wrong').toString('base64')}` }) as never)).status).toBe(401)
    expect((await webhook(signed(txEvent({ externalReference: 'gl_w1', status: 'SUCCESS' }), { ts: Math.floor(Date.now() / 1000) - 3600 }) as never)).status).toBe(401)
    expect(db.rows('payfast_payments')[0].status).toBe('pending')
    expect(db.rows('stitch_webhook_events')).toHaveLength(0)
  })

  it('SUCCESS on a pending row completes it and grants the bet; the same delivery again is a no-op', async () => {
    seed(); ledger('pending')
    const req = () => signed(txEvent({ externalReference: 'gl_w1', status: 'SUCCESS', amount: { quantity: '50.00', currency: 'ZAR' } }), { id: 'msg_same' })
    const res = await webhook(req() as never)
    expect(res.status).toBe(200)
    expect((await res.json()).result).toBe('completed')
    expect(db.rows('payfast_payments')[0]).toMatchObject({ status: 'complete', provider_ref: 'tx-9' })
    expect(db.rows('bets')).toHaveLength(1)
    expect(db.rows('bets')[0]).toMatchObject({ hole_id: HOLE_ID, payment_intent_id: 'gl_w1' })
    const again = await webhook(req() as never)
    expect((await again.json()).duplicate).toBe(true)
    expect(db.rows('bets')).toHaveLength(1)
    expect(db.rows('stitch_webhook_events')).toHaveLength(1)
  })

  it('SUCCESS on an unknown row completes it too; on a row already complete it only grants what is missing', async () => {
    seed(); ledger('unknown')
    await webhook(signed(txEvent({ externalReference: 'gl_w1', status: 'SUCCESS', amount: { quantity: '50.00' } })) as never)
    expect(db.rows('payfast_payments')[0].status).toBe('complete')
    expect(db.rows('bets')).toHaveLength(1)
    // The charge route completed the row but the grant failed to land; the webhook catches it.
    db = new FakeDb(); adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
    seed(); ledger('complete', { provider_ref: null })
    const res = await webhook(signed(txEvent({ externalReference: 'gl_w1', status: 'SUCCESS', amount: { quantity: '50.00' } })) as never)
    expect((await res.json()).result).toBe('already_complete')
    expect(db.rows('payfast_payments')[0].provider_ref).toBe('tx-9')
    expect(db.rows('bets')).toHaveLength(1)
  })

  it('a SUCCESS for a different amount is amount_mismatch with no bet', async () => {
    seed(); ledger('pending')
    const res = await webhook(signed(txEvent({ externalReference: 'gl_w1', status: 'SUCCESS', amount: { quantity: '25.00', currency: 'ZAR' } })) as never)
    expect((await res.json()).result).toBe('mismatched')
    expect(db.rows('payfast_payments')[0].status).toBe('amount_mismatch')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('FAILURE and CANCELLED mark a pending or unknown row failed; a complete row is never moved back', async () => {
    seed(); ledger('pending')
    expect((await (await webhook(signed(txEvent({ externalReference: 'gl_w1', status: 'FAILURE', statusReason: 'Declined' })) as never)).json()).result).toBe('failed')
    expect(db.rows('payfast_payments')[0].status).toBe('failed')
    db = new FakeDb(); adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
    seed(); ledger('complete')
    expect((await (await webhook(signed(txEvent({ externalReference: 'gl_w1', status: 'CANCELLED' })) as never)).json()).result).toBe('noop')
    expect(db.rows('payfast_payments')[0].status).toBe('complete')
  })

  it('ignores events that are not ours (another type, a foreign reference, a PayFast row) and still records them', async () => {
    seed(); db.seed('payfast_payments', { m_payment_id: 'gl_pf', user_id: USER_A.id, status: 'pending', amount_cents: 5000, tier: 'tier_1', course_id: COURSE_ID, hole_id: HOLE_ID })
    expect((await (await webhook(signed({ type: 'payment-consent-request', id: 'e', data: { id: 'c', status: 'GRANTED' } }) as never)).json()).ignored).toBe(true)
    expect((await (await webhook(signed(txEvent({ externalReference: 'other-shop-1', status: 'SUCCESS' })) as never)).json()).ignored).toBe(true)
    expect((await (await webhook(signed(txEvent({ externalReference: 'gl_pf', status: 'SUCCESS', amount: { quantity: '50.00' } })) as never)).json()).result).toBe('noop')
    expect(db.rows('payfast_payments')[0].status).toBe('pending')
    expect(db.rows('stitch_webhook_events')).toHaveLength(3)
  })
})

describe('reconciliation', () => {
  const cfg = () => { const r = resolveStitchConfig(); if (!r.ok) throw new Error(r.reason); return r.config }
  const now = new Date('2026-10-13T10:00:00Z')
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString()
  const found = (state: string, quantity = '50.00') => ({ json: { data: { client: { transactions: { edges: [{ node: { __typename: 'ApplePayTransaction', id: 'tx-r', externalReference: 'gl_r1', amount: { quantity, currency: 'ZAR' }, state: { __typename: state } } }] } } } } })
  const notFound = { json: { data: { client: { transactions: { edges: [] } } } } }
  const row = (status: string, ageMinutes: number) =>
    db.seed('payfast_payments', { m_payment_id: 'gl_r1', user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', amount_cents: 5000, status, provider: 'stitch', raw_payload: { source: 'wallet' }, created_at: minutesAgo(ageMinutes) })

  it('leaves a young row alone, completes an unknown one Stitch confirms, and grants the bet', async () => {
    seed(); row('unknown', 1)
    const admin = createFakeClient(db) as never
    expect(await reconcileStitchPayments(admin, cfg(), { now })).toMatchObject({ checked: 0 })
    db.rows('payfast_payments')[0].created_at = minutesAgo(3)
    vi.stubGlobal('fetch', stitchFetch([found('TransactionSuccess')]))
    expect(await reconcileStitchPayments(admin, cfg(), { now })).toMatchObject({ checked: 1, completed: 1 })
    expect(db.rows('payfast_payments')[0]).toMatchObject({ status: 'complete', provider_ref: 'tx-r' })
    expect(db.rows('bets')).toHaveLength(1)
  })

  it('a row Stitch has no record of is left for ten minutes, then failed; a pending 3-D Secure is left for a day', async () => {
    seed(); row('unknown', 5)
    const admin = createFakeClient(db) as never
    vi.stubGlobal('fetch', stitchFetch([notFound]))
    expect(await reconcileStitchPayments(admin, cfg(), { now })).toMatchObject({ checked: 1, left: 1 })
    db.rows('payfast_payments')[0].created_at = minutesAgo(11)
    expect(await reconcileStitchPayments(admin, cfg(), { now })).toMatchObject({ checked: 1, failed: 1 })
    expect(db.rows('payfast_payments')[0].status).toBe('failed')

    db = new FakeDb(); seed(); row('pending', 60)
    const admin2 = createFakeClient(db) as never
    vi.stubGlobal('fetch', stitchFetch([found('TransactionPending')]))
    expect(await reconcileStitchPayments(admin2, cfg(), { now })).toMatchObject({ checked: 1, left: 1 })
    db.rows('payfast_payments')[0].created_at = minutesAgo(25 * 60)
    expect(await reconcileStitchPayments(admin2, cfg(), { now })).toMatchObject({ checked: 1, failed: 1 })
  })

  it('Stitch unreachable leaves the row; a mismatched amount is flagged without a bet', async () => {
    seed(); row('unknown', 5)
    const admin = createFakeClient(db) as never
    vi.stubGlobal('fetch', stitchFetch([new Error('ECONNRESET')]))
    expect(await reconcileStitchPayments(admin, cfg(), { now })).toMatchObject({ checked: 1, left: 1 })
    expect(db.rows('payfast_payments')[0].status).toBe('unknown')
    resetStitchTokenCache()
    vi.stubGlobal('fetch', stitchFetch([found('TransactionSuccess', '25.00')]))
    expect(await reconcileStitchPayments(admin, cfg(), { now })).toMatchObject({ checked: 1, mismatched: 1 })
    expect(db.rows('payfast_payments')[0].status).toBe('amount_mismatch')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it("the PayFast sweep never asks PayFast about a Stitch row, and a settle never touches a PayFast row", async () => {
    seed(); row('unknown', 5)
    const admin = createFakeClient(db) as never
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const pfConfig = { merchantId: '1', merchantKey: 'k', passphrase: 'p', sandbox: true, apiBase: 'https://api.payfast.co.za' }
    expect(await reconcileUnknownPayments(admin, pfConfig as never, { now })).toMatchObject({ checked: 0 })
    expect(f).not.toHaveBeenCalled()
    db.seed('payfast_payments', { m_payment_id: 'gl_pf', user_id: USER_A.id, status: 'unknown', amount_cents: 5000, tier: 'tier_1', provider: 'payfast' })
    expect(await settleStitchTransaction(admin, { reference: 'gl_pf', stitchId: 'tx', status: 'SUCCESS', reason: null, amountCents: 5000, source: 'webhook' })).toBe('noop')
    expect(db.find('payfast_payments', r => r.m_payment_id === 'gl_pf')!.status).toBe('unknown')
  })
})

describe('the browser half', () => {
  it('is off without the public flags; Google Pay needs a merchant id in PRODUCTION', () => {
    expect(walletPublicConfig({})).toEqual({ applePay: false, googlePay: null, merchantName: 'Get Lucky Golf' })
    expect(walletPublicConfig({ NEXT_PUBLIC_STITCH_APPLE_PAY: 'on', NEXT_PUBLIC_STITCH_GATEWAY_MERCHANT_ID: 'gm_1' })).toMatchObject({ applePay: true, googlePay: { gateway: 'stitch', gatewayMerchantId: 'gm_1', merchantId: null, environment: 'TEST' } })
    expect(walletPublicConfig({ NEXT_PUBLIC_STITCH_GATEWAY_MERCHANT_ID: 'gm_1', NEXT_PUBLIC_VERCEL_ENV: 'production' }).googlePay).toBeNull()
    expect(walletPublicConfig({ NEXT_PUBLIC_STITCH_GATEWAY_MERCHANT_ID: 'gm_1', NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID: 'BCR2DN...', NEXT_PUBLIC_VERCEL_ENV: 'production', NEXT_PUBLIC_STITCH_GOOGLE_GATEWAY: 'stitchmoney' }).googlePay)
      .toEqual({ gateway: 'stitchmoney', gatewayMerchantId: 'gm_1', merchantId: 'BCR2DN...', environment: 'PRODUCTION' })
  })
  it('asks the sheets for exactly the tier amount in rand, Visa and Mastercard, 3-D Secure capable', () => {
    expect(applePayRequest(250)).toEqual({ countryCode: 'ZA', currencyCode: 'ZAR', supportedNetworks: ['visa', 'masterCard'], merchantCapabilities: ['supports3DS'], total: { label: 'Get Lucky Golf', amount: '250.00', type: 'final' } })
    const g = googlePayRequest({ gateway: 'stitch', gatewayMerchantId: 'gm_1', merchantId: 'M1', environment: 'PRODUCTION' }, 50)
    expect(g.transactionInfo).toEqual({ totalPriceStatus: 'FINAL', totalPrice: '50.00', currencyCode: 'ZAR', countryCode: 'ZA' })
    expect(g.allowedPaymentMethods[0].parameters.allowedAuthMethods).toEqual(['CRYPTOGRAM_3DS'])
    expect(g.allowedPaymentMethods[0].tokenizationSpecification).toEqual({ type: 'PAYMENT_GATEWAY', parameters: { gateway: 'stitch', gatewayMerchantId: 'gm_1' } })
    expect(g.merchantInfo).toEqual({ merchantName: 'Get Lucky Golf', merchantId: 'M1' })
  })
  it('encodes the wallet token the way Stitch wants it and builds the 3-D Secure return URL', () => {
    expect(encodeWalletToken('apple_pay', { paymentData: { data: 'x', version: 'EC_v1' } })).toBe(Buffer.from('{"data":"x","version":"EC_v1"}').toString('base64'))
    expect(encodeWalletToken('google_pay', { token: '{"signature":"s"}' })).toBe(Buffer.from('{"signature":"s"}').toString('base64'))
    expect(threeDsReturnUrl('https://3ds.stitch.money/x', 'https://www.getluckyholeinone.com', 'gl_1'))
      .toBe('https://3ds.stitch.money/x?redirect_uri=' + encodeURIComponent('https://www.getluckyholeinone.com/payment-return?ref=gl_1'))
    expect(threeDsReturnUrl('https://3ds.stitch.money/x?id=1', 'https://a.b', 'gl_1')).toMatch(/^https:\/\/3ds\.stitch\.money\/x\?id=1&redirect_uri=/)
  })
  it('serves the Apple domain file from the environment, or 404', async () => {
    expect((await domainFile()).status).toBe(404)
    vi.stubEnv('APPLE_PAY_DOMAIN_ASSOCIATION', '7B227073704964223A22...')
    const res = await domainFile()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(await res.text()).toBe('7B227073704964223A22...')
  })
})
