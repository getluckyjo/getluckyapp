/**
 * A card on the account profile, held by Stitch (migration 046).
 *
 * The consent request (start, return leg, webhook), the one-tap charge
 * through the existing /api/payments/payfast/charge route when the card
 * row names Stitch, and removal. Invariants: a consent is attached only
 * to the golfer who started it, and only once Stitch says granted; the
 * query string on the return leg is never believed on its own; the
 * charge keeps the ledger-first rule and the saved-card bounds; removal
 * revokes at Stitch and the row goes even when Stitch cannot be reached.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID, type FakeUser } from '../helpers/fake-supabase'
import { resetStitchTokenCache } from '@/lib/stitch/api'
import { cardLabel, consentCardOf, consentRedirectUrl, consentStateOf } from '@/lib/stitch/cards'
import { POST as startCard } from '@/app/api/payments/card/stitch/route'
import { GET as returnCard } from '@/app/api/payments/card/stitch/return/route'
import { GET as getCard, DELETE as deleteCard } from '@/app/api/payments/card/route'
import { POST as charge } from '@/app/api/payments/payfast/charge/route'
import { POST as webhook } from '@/app/api/payments/stitch/webhook/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb
const SECRET_B64 = Buffer.from('unit-test-webhook-secret-32-bytes!!').toString('base64')
const WEBHOOK_SECRET = `whsec_${SECRET_B64}`
const CONSENT_ID = 'cmVjdXJyaW5nUGF5bWVudENvbnNlbnRSZXF1ZXN0L2NiNmYyYmQ5'
const HOSTED = 'https://secure.stitch.money/v2/interaction?transactionId=abc&clientId=test-abc123'

function env(over: Record<string, string | undefined> = {}) {
  vi.unstubAllEnvs()
  const base: Record<string, string | undefined> = {
    STITCH_CLIENT_ID: 'test-abc123', STITCH_CLIENT_SECRET: 'shh', STITCH_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STITCH_APPLE_MERCHANT_IDENTIFIER: 'merchant.money.stitch.getlucky',
    PAYFAST_MERCHANT_ID: '10012345', PAYFAST_MERCHANT_KEY: 'sandboxkey123', PAYFAST_PASSPHRASE: 'unit-test-passphrase', PAYFAST_SANDBOX: 'true',
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
const stitchCard = () => db.seed('payment_cards', { user_id: USER_A.id, token: CONSENT_ID, provider: 'stitch', label: 'Visa •••• 0331', created_at: '2026-10-13T06:00:00Z', last_used_at: null })

type Reply = { status?: number; json: unknown }
function stitchFetch(graphqlReplies: (Reply | Error)[]) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = []
  let i = 0
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>))
    const rawBody = String(init.body)
    const body = rawBody.startsWith('{') ? JSON.parse(rawBody) : Object.fromEntries(new URLSearchParams(rawBody))
    calls.push({ url, body, headers })
    if (url.endsWith('/connect/token')) return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 })
    const reply = graphqlReplies[i++] ?? graphqlReplies[graphqlReplies.length - 1]
    if (reply instanceof Error) throw reply
    return new Response(JSON.stringify(reply.json), { status: reply.status ?? 200 })
  })
  return Object.assign(fn, { calls })
}
const consentNode = (typename: string, card: Record<string, unknown> | null = { last4: '0331', network: 'Visa', type: 'Credit', issuer: { name: 'capitec' } }) =>
  ({ json: { data: { node: { id: CONSENT_ID, state: { __typename: typename }, card } } } })
const initiated = (state: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ json: { data: { initiateTransaction: { __typename: 'CardTransaction', id: 'tx-c1', interactionUrl: null, state, ...extra } } } })

function signed(body: unknown, opts: { id?: string } = {}) {
  const raw = JSON.stringify(body)
  const id = opts.id ?? `msg_${Math.random().toString(36).slice(2)}`
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = createHmac('sha256', Buffer.from(SECRET_B64, 'base64')).update(`${id}.${ts}.${raw}`).digest('base64')
  return new Request('http://x/api/payments/stitch/webhook', { method: 'POST', body: raw, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` } })
}
const consentEvent = (status: string, over: Record<string, unknown> = {}) => ({
  type: 'payment-consent-request', id: `payment-consent-request:status:${status.toLowerCase()}:x`, datetime: '2026-10-13T10:00:00Z',
  data: { id: CONSENT_ID, status, type: 'CARD', nonce: 'n', card: { bin: '555550', last4: '0331', network: 'Mastercard', type: 'Credit', issuer: { name: 'capitec', country: 'ZA' } }, ...over },
})
const ret = (query: string) => returnCard(new Request(`https://preview.example.com/api/payments/card/stitch/return?${query}`) as never)
const chargePost = () => charge(jsonRequest('http://x/api/payments/payfast/charge', { tier: 'tier_1', courseId: COURSE_ID, holeId: HOLE_ID }) as never)

beforeEach(() => {
  db = new FakeDb()
  env()
  resetStitchTokenCache()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.stubGlobal('fetch', stitchFetch([]))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('helpers', () => {
  it('reads consent states from typenames and webhook statuses; labels the card without the number', () => {
    expect(consentStateOf('PaymentConsentGranted')).toBe('granted')
    expect(consentStateOf('GRANTED')).toBe('granted')
    expect(consentStateOf('PaymentConsentPending')).toBe('pending')
    expect(consentStateOf('EXPIRED')).toBe('expired')
    expect(consentStateOf('PaymentConsentRevoked')).toBe('revoked')
    expect(consentStateOf('CANCELLED')).toBe('failed')
    expect(consentStateOf(undefined)).toBe('unknown')
    expect(cardLabel(consentCardOf({ last4: '0331', network: 'Mastercard', type: 'Credit', issuer: { name: 'capitec' } }))).toBe('Mastercard •••• 0331')
    expect(cardLabel(consentCardOf({ network: 'VISA' }))).toBe('Visa')
    expect(cardLabel(null)).toBe('Saved card')
    expect(consentRedirectUrl(HOSTED, 'https://preview.example.com/api/payments/card/stitch/return')).toBe(`${HOSTED}&redirect_uri=${encodeURIComponent('https://preview.example.com/api/payments/card/stitch/return')}`)
  })
})

describe('POST /api/payments/card/stitch', () => {
  const post = () => startCard(jsonRequest('http://x/api/payments/card/stitch', {}) as never)

  it('503 when Stitch is off; 401 without a session; 409 with a card already', async () => {
    env({ STITCH_CLIENT_ID: undefined }); asUser(USER_A); seed()
    expect((await post()).status).toBe(503)
    env(); asUser(null)
    expect((await post()).status).toBe(401)
    asUser(USER_A); stitchCard()
    const res = await post()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('CARD_EXISTS')
    expect(db.rows('stitch_consent_requests')).toHaveLength(0)
  })

  it('creates the consent with a unique nonce and an expiry, records it for the golfer, and returns the hosted URL with our return leg', async () => {
    asUser(USER_A); seed()
    const f = stitchFetch([{ json: { data: { paymentConsentRequestCreate: { id: CONSENT_ID, url: HOSTED } } } }])
    vi.stubGlobal('fetch', f)
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe(`${HOSTED}&redirect_uri=${encodeURIComponent('https://preview.example.com/api/payments/card/stitch/return')}`)
    expect(f.calls[0].body).toMatchObject({ scope: 'client_recurringpaymentconsentrequest' })
    const { variables } = f.calls[1].body as { variables: { nonce: string; expireAt: string } }
    expect(variables.nonce).toMatch(/^[0-9a-f-]{36}$/)
    expect(Date.parse(variables.expireAt)).toBeGreaterThan(Date.now())
    expect(db.rows('stitch_consent_requests')[0]).toMatchObject({ id: CONSENT_ID, user_id: USER_A.id, status: 'pending' })
  })
})

describe('GET /api/payments/card/stitch/return', () => {
  const pending = (user = USER_A.id) => db.seed('stitch_consent_requests', { id: CONSENT_ID, user_id: user, status: 'pending' })
  const landing = (res: Response) => new URL(res.headers.get('location')!).search

  it('sends a signed-out visitor to sign in; an unknown or another golfer\'s consent is an error with nothing attached', async () => {
    asUser(null); pending()
    const out = await ret(`id=${CONSENT_ID}&status=completed`)
    expect(out.status).toBe(303)
    expect(out.headers.get('location')).toMatch(/\/auth\?next=/)
    asUser(USER_B)
    expect(landing(await ret(`id=${CONSENT_ID}&status=completed`))).toBe('?card=error')
    asUser(USER_A)
    expect(landing(await ret('id=someone-elses&status=completed'))).toBe('?card=error')
    expect(db.rows('payment_cards')).toHaveLength(0)
  })

  it('attaches the card only when Stitch says granted, whatever the query string says', async () => {
    asUser(USER_A); seed(); pending()
    vi.stubGlobal('fetch', stitchFetch([consentNode('PaymentConsentPending', null)]))
    expect(landing(await ret(`id=${CONSENT_ID}&status=completed`))).toBe('?card=pending')
    expect(db.rows('payment_cards')).toHaveLength(0)

    resetStitchTokenCache()
    vi.stubGlobal('fetch', stitchFetch([consentNode('PaymentConsentGranted')]))
    expect(landing(await ret(`id=${CONSENT_ID}&status=closed`))).toBe('?card=saved')
    expect(db.rows('payment_cards')[0]).toMatchObject({ user_id: USER_A.id, token: CONSENT_ID, provider: 'stitch', label: 'Visa •••• 0331' })
    expect(db.rows('stitch_consent_requests')[0].status).toBe('granted')
    // Back again (a reload): already granted, no second call to Stitch.
    const f = stitchFetch([])
    vi.stubGlobal('fetch', f)
    expect(landing(await ret(`id=${CONSENT_ID}&status=completed`))).toBe('?card=saved')
    expect(f.calls).toHaveLength(0)
  })

  it('a closed page is cancelled; an expired consent is cancelled; Stitch unreachable defers to the webhook', async () => {
    asUser(USER_A); seed(); pending()
    vi.stubGlobal('fetch', stitchFetch([consentNode('PaymentConsentPending', null)]))
    expect(landing(await ret(`id=${CONSENT_ID}&status=closed`))).toBe('?card=cancelled')
    expect(db.rows('stitch_consent_requests')[0].status).toBe('closed')

    db = new FakeDb(); adminClient.createAdminClient.mockImplementation(() => createFakeClient(db)); asUser(USER_A); seed(); pending()
    resetStitchTokenCache()
    vi.stubGlobal('fetch', stitchFetch([consentNode('PaymentConsentExpired', null)]))
    expect(landing(await ret(`id=${CONSENT_ID}&status=failed`))).toBe('?card=cancelled')
    expect(db.rows('stitch_consent_requests')[0].status).toBe('expired')

    db = new FakeDb(); adminClient.createAdminClient.mockImplementation(() => createFakeClient(db)); asUser(USER_A); seed(); pending()
    resetStitchTokenCache()
    vi.stubGlobal('fetch', stitchFetch([new Error('ECONNRESET')]))
    expect(landing(await ret(`id=${CONSENT_ID}&status=completed`))).toBe('?card=pending')
    expect(db.rows('stitch_consent_requests')[0].status).toBe('pending')
    expect(db.rows('payment_cards')).toHaveLength(0)
  })
})

describe('payment-consent-request webhooks', () => {
  it('GRANTED attaches the card to the golfer who started the consent, once; a consent we never started is ignored', async () => {
    seed(); db.seed('stitch_consent_requests', { id: CONSENT_ID, user_id: USER_A.id, status: 'pending' })
    const res = await webhook(signed(consentEvent('GRANTED'), { id: 'msg_g1' }) as never)
    expect((await res.json()).result).toBe('attached')
    expect(db.rows('payment_cards')[0]).toMatchObject({ user_id: USER_A.id, token: CONSENT_ID, provider: 'stitch', label: 'Mastercard •••• 0331' })
    expect((await (await webhook(signed(consentEvent('GRANTED'), { id: 'msg_g2' }) as never)).json()).result).toBe('already')
    expect(db.rows('payment_cards')).toHaveLength(1)
    expect((await (await webhook(signed(consentEvent('GRANTED', { id: 'not-ours' })) as never)).json()).ignored).toBe(true)
  })

  it('REVOKED or EXPIRED removes the card it holds; FAILED closes a pending request', async () => {
    seed(); db.seed('stitch_consent_requests', { id: CONSENT_ID, user_id: USER_A.id, status: 'granted' }); stitchCard()
    expect((await (await webhook(signed(consentEvent('REVOKED')) as never)).json()).result).toBe('detached')
    expect(db.rows('payment_cards')).toHaveLength(0)
    expect(db.rows('stitch_consent_requests')[0].status).toBe('revoked')

    db = new FakeDb(); adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
    seed(); db.seed('stitch_consent_requests', { id: CONSENT_ID, user_id: USER_A.id, status: 'pending' })
    expect((await (await webhook(signed(consentEvent('FAILED')) as never)).json()).result).toBe('closed')
    expect(db.rows('stitch_consent_requests')[0].status).toBe('failed')
  })

  it('a granted consent never displaces a different card already on the account', async () => {
    seed(); db.seed('stitch_consent_requests', { id: CONSENT_ID, user_id: USER_A.id, status: 'pending' })
    db.seed('payment_cards', { user_id: USER_A.id, token: 'pf-token', provider: 'payfast', label: 'Saved card' })
    expect((await (await webhook(signed(consentEvent('GRANTED')) as never)).json()).result).toBe('other_card')
    expect(db.rows('payment_cards')).toHaveLength(1)
    expect(db.rows('payment_cards')[0].token).toBe('pf-token')
  })
})

describe('one tap with a Stitch card (POST /api/payments/payfast/charge)', () => {
  it('reserves the ledger row with provider stitch, charges the consent, completes and grants the bet', async () => {
    asUser(USER_A); seed(); stitchCard()
    const f = stitchFetch([initiated({ __typename: 'TransactionSuccess' })])
    vi.stubGlobal('fetch', f)
    const res = await chargePost()
    expect(res.status).toBe(200)
    const { betId, m_payment_id } = await res.json()
    expect(f.calls.map(c => c.url)).toEqual(['https://secure.stitch.money/connect/token', 'https://api.stitch.money/graphql'])
    const { variables } = f.calls[1].body as { variables: { input: Record<string, unknown> } }
    expect(variables.input).toMatchObject({ amount: { quantity: '50.00', currency: 'ZAR' }, externalReference: m_payment_id, token: CONSENT_ID, payerInformation: { payerId: USER_A.id } })
    expect(variables.input).not.toHaveProperty('paymentMethods')
    expect(db.rows('payfast_payments')[0]).toMatchObject({ m_payment_id, provider: 'stitch', provider_ref: 'tx-c1', status: 'complete', hole_id: HOLE_ID, bet_id: betId })
    expect((db.rows('payfast_payments')[0].raw_payload as { source: string }).source).toBe('saved_card')
    expect(db.find('payment_cards', c => c.user_id === USER_A.id)!.last_used_at).toBeTruthy()
    expect(db.rows('bets')[0]).toMatchObject({ payment_intent_id: m_payment_id, hole_id: HOLE_ID })
  })

  it('402 CARD_DECLINED on a refusal; 202 THREE_DS when the bank wants a step; 409 CHARGE_UNKNOWN with no answer; never a bet', async () => {
    asUser(USER_A); seed(); stitchCard()
    vi.stubGlobal('fetch', stitchFetch([initiated({ __typename: 'TransactionFailure', reason: 'Declined', reasonDescription: 'Insufficient funds' })]))
    const declined = await chargePost()
    expect(declined.status).toBe(402)
    expect((await declined.json()).code).toBe('CARD_DECLINED')
    expect(db.rows('payfast_payments')[0].status).toBe('failed')

    resetStitchTokenCache()
    vi.stubGlobal('fetch', stitchFetch([initiated({ __typename: 'TransactionPending', reason: 'ThreeDSecureRequired' }, { interactionUrl: 'https://3ds.stitch.money/x' })]))
    const threeDs = await chargePost()
    expect(threeDs.status).toBe(202)
    expect(await threeDs.json()).toMatchObject({ code: 'THREE_DS', interactionUrl: 'https://3ds.stitch.money/x' })
    expect(db.rows('payfast_payments')[1]).toMatchObject({ status: 'pending', provider: 'stitch', provider_ref: 'tx-c1' })

    resetStitchTokenCache()
    vi.stubGlobal('fetch', stitchFetch([new Error('timeout')]))
    const unknown = await chargePost()
    expect(unknown.status).toBe(409)
    expect((await unknown.json()).code).toBe('CHARGE_UNKNOWN')
    expect(db.rows('payfast_payments')[2].status).toBe('unknown')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('keeps the saved-card bounds: the daily cap counts Stitch charges too', async () => {
    asUser(USER_A); seed(); stitchCard()
    db.seed('payfast_payments', { m_payment_id: 'gl_old', user_id: USER_A.id, status: 'complete', amount_cents: 250_000, tier: 'tier_3', provider: 'stitch', raw_payload: { source: 'saved_card' }, created_at: new Date(Date.now() - 3_600_000).toISOString() })
    const f = stitchFetch([])
    vi.stubGlobal('fetch', f)
    const res = await chargePost()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('SAVED_CARD_LIMIT')
    expect(f.calls).toHaveLength(0)
  })

  it('503 when the card is Stitch\'s and Stitch is not configured; PayFast cards are untouched by that', async () => {
    env({ STITCH_CLIENT_ID: undefined }); asUser(USER_A); seed(); stitchCard()
    expect((await chargePost()).status).toBe(503)
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })
})

describe('GET and DELETE /api/payments/card with a Stitch card', () => {
  it('reports the provider; removal revokes the consent at Stitch and deletes the row even when Stitch cannot be reached', async () => {
    asUser(USER_A); seed(); stitchCard(); db.seed('stitch_consent_requests', { id: CONSENT_ID, user_id: USER_A.id, status: 'granted' })
    expect((await (await getCard()).json()).card).toMatchObject({ label: 'Visa •••• 0331', provider: 'stitch' })

    const f = stitchFetch([{ json: { data: { paymentConsentRequestRevoke: { id: CONSENT_ID } } } }])
    vi.stubGlobal('fetch', f)
    expect((await (await deleteCard()).json()).removed).toBe(true)
    const { variables } = f.calls[1].body as { variables: { id: string; reason: string } }
    expect(variables.id).toBe(CONSENT_ID)
    expect(db.rows('payment_cards')).toHaveLength(0)
    expect(db.rows('stitch_consent_requests')[0].status).toBe('revoked')

    stitchCard()
    resetStitchTokenCache()
    vi.stubGlobal('fetch', stitchFetch([new Error('ECONNRESET')]))
    expect((await (await deleteCard()).json()).removed).toBe(true)
    expect(db.rows('payment_cards')).toHaveLength(0)
  })
})
