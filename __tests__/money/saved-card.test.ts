/**
 * Saved cards (PayFast tokenization, migration 021).
 *
 * The API signature, the one-call charge (/api/payments/payfast/charge)
 * and the card endpoints (/api/payments/card). Money invariants: the
 * ledger row exists before PayFast is asked; a refusal leaves 'failed' and
 * no bet; a success leaves 'complete' and a bet on the hole the golfer
 * chose, granted on the same rules as any other payment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { FakeDb, createFakeClient, jsonRequest, USER_A, COURSE_ID, HOLE_ID, type FakeUser } from '../helpers/fake-supabase'
import { apiSignature, apiTimestamp } from '@/lib/payfast/api'
import { POST as charge } from '@/app/api/payments/payfast/charge/route'
import { GET as getCard, DELETE as deleteCard } from '@/app/api/payments/card/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb
const TOKEN = 'dc0521d3-55fe-269b-fa00-b647310d760f'

function env(over: Record<string, string | undefined> = {}) {
  vi.unstubAllEnvs()
  const base: Record<string, string | undefined> = {
    PAYFAST_MERCHANT_ID: '10012345', PAYFAST_MERCHANT_KEY: 'sandboxkey123', PAYFAST_PASSPHRASE: 'unit-test-passphrase',
    PAYFAST_SANDBOX: 'true', NEXT_PUBLIC_SITE_URL: 'https://preview.example.com', VERCEL_ENV: 'preview', ...over,
  }
  for (const [k, v] of Object.entries(base)) if (v !== undefined) vi.stubEnv(k, v)
}
function asUser(user: FakeUser | null) {
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user }))
}
function seed(opts: { card?: boolean; verified?: boolean; metres?: number } = {}) {
  db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek', is_partner: true })
  db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 4, par: 3, distance_metres: opts.metres ?? 165, is_active: true })
  db.seed('profiles', { id: USER_A.id, age_verified_at: opts.verified === false ? null : '2026-01-01T00:00:00Z', total_attempts: 0 })
  if (opts.card !== false) db.seed('payment_cards', { user_id: USER_A.id, token: TOKEN, label: 'Saved card', created_at: '2026-09-17T06:00:00Z', last_used_at: null })
}
const payfastOk = (pfPaymentId = '2200001') => vi.fn(async () => new Response(JSON.stringify({ code: 200, status: 'success', data: { response: { pf_payment_id: pfPaymentId }, message: 'Success' } }), { status: 200 }))
const post = (body: unknown) => charge(jsonRequest('http://x/api/payments/payfast/charge', body) as never)
const good = { tier: 'tier_1', courseId: COURSE_ID, holeId: HOLE_ID }

beforeEach(() => {
  db = new FakeDb()
  env()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.stubGlobal('fetch', payfastOk())
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('API signature', () => {
  it('is the MD5 of the alphabetised headers, body and passphrase, PayFast-encoded', () => {
    const fields = { 'merchant-id': '10012345', version: 'v1', timestamp: '2026-09-17T06:00:00+00:00', amount: '5000', item_name: 'Get Lucky Golf - R50 Entry' }
    const expected = createHash('md5').update(
      'amount=5000&item_name=Get+Lucky+Golf+-+R50+Entry&merchant-id=10012345&passphrase=unit-test-passphrase&timestamp=2026-09-17T06%3A00%3A00%2B00%3A00&version=v1',
    ).digest('hex')
    expect(apiSignature(fields, 'unit-test-passphrase')).toBe(expected)
  })
  it('stamps ISO-8601 with a numeric offset', () => {
    expect(apiTimestamp(new Date('2026-09-17T06:00:00.123Z'))).toBe('2026-09-17T06:00:00+00:00')
  })
})

describe('POST /api/payments/payfast/charge', () => {
  it('401 without a session; 404 without a saved card', async () => {
    asUser(null); seed()
    expect((await post(good)).status).toBe(401)
    db = new FakeDb(); asUser(USER_A); seed({ card: false })
    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
    expect((await post(good)).status).toBe(404)
  })

  it('charges the token once, writes the ledger first, and grants the bet on the chosen hole', async () => {
    asUser(USER_A); seed()
    const fetchMock = payfastOk('2200001')
    vi.stubGlobal('fetch', fetchMock)
    const res = await post(good)
    expect(res.status).toBe(200)
    const { betId, m_payment_id } = await res.json()
    expect(m_payment_id).toMatch(/^gl_/)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.payfast.co.za/subscriptions/${TOKEN}/adhoc?testing=true`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['merchant-id']).toBe('10012345')
    expect(headers.version).toBe('v1')
    const body = Object.fromEntries(new URLSearchParams(String(init.body)))
    expect(body).toEqual({ amount: '5000', item_name: 'Get Lucky Golf - R50 Entry', m_payment_id })
    expect(headers.signature).toBe(apiSignature({ 'merchant-id': '10012345', version: 'v1', timestamp: headers.timestamp, ...body }, 'unit-test-passphrase'))

    const [row] = db.rows('payfast_payments')
    expect(row).toMatchObject({ m_payment_id, user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', amount_cents: 5000, status: 'complete', pf_payment_id: '2200001', bet_id: betId })
    const bet = db.find('bets', b => b.id === betId)!
    expect(bet).toMatchObject({ user_id: USER_A.id, hole_id: HOLE_ID, tier: 'tier_1', stake_pence: 5000, status: 'active', payment_intent_id: m_payment_id, pf_payment_id: '2200001' })
    expect(db.find('payment_cards', c => c.user_id === USER_A.id)!.last_used_at).toBeTruthy()
  })

  it('402 CARD_DECLINED when PayFast refuses: the ledger row is failed and no bet exists', async () => {
    asUser(USER_A); seed()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 400, status: 'failed', data: { response: false, message: 'Insufficient funds' } }), { status: 400 })))
    const res = await post(good)
    expect(res.status).toBe(402)
    expect((await res.json()).code).toBe('CARD_DECLINED')
    expect(db.rows('payfast_payments')[0]).toMatchObject({ status: 'failed', hole_id: HOLE_ID })
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('502 CHARGE_UNAVAILABLE when PayFast cannot be reached, leaving a failed row and no bet', async () => {
    asUser(USER_A); seed()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const res = await post(good)
    expect(res.status).toBe(502)
    expect(db.rows('payfast_payments')[0].status).toBe('failed')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('refuses a hole under 140m before touching the card or the ledger', async () => {
    asUser(USER_A); seed({ metres: 120 })
    const fetchMock = payfastOk()
    vi.stubGlobal('fetch', fetchMock)
    const res = await post(good)
    expect((await res.json()).code).toBe('HOLE_NOT_ELIGIBLE')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })

  it('409 when the card is charged but the bet cannot be granted (age not verified): the payment is kept complete', async () => {
    asUser(USER_A); seed({ verified: false })
    const res = await post(good)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('AGE_NOT_VERIFIED')
    expect(json.m_payment_id).toMatch(/^gl_/)
    expect(db.rows('payfast_payments')[0].status).toBe('complete')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('503 when PayFast is misconfigured, charging nothing', async () => {
    env({ PAYFAST_PASSPHRASE: undefined, VERCEL_ENV: 'production' })
    asUser(USER_A); seed()
    const fetchMock = payfastOk()
    vi.stubGlobal('fetch', fetchMock)
    expect((await post(good)).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('/api/payments/card', () => {
  it('GET says whether a card is saved, never the token', async () => {
    asUser(USER_A); seed({ card: false })
    expect(await (await getCard()).json()).toEqual({ card: null })
    db.seed('payment_cards', { user_id: USER_A.id, token: TOKEN, label: 'Saved card', created_at: '2026-09-17T06:00:00Z', last_used_at: null })
    const { card } = await (await getCard()).json()
    expect(card).toEqual({ label: 'Saved card', savedAt: '2026-09-17T06:00:00Z', lastUsedAt: null })
    expect(JSON.stringify(card)).not.toContain(TOKEN)
  })

  it('DELETE cancels the agreement at PayFast and forgets the card', async () => {
    asUser(USER_A); seed()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 200, status: 'success', data: { response: true } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await (await deleteCard()).json()).toEqual({ removed: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.payfast.co.za/subscriptions/${TOKEN}/cancel?testing=true`)
    expect(init.method).toBe('PUT')
    expect(db.rows('payment_cards')).toHaveLength(0)
  })

  it('DELETE still forgets the card when PayFast is unreachable, and 401 signed out', async () => {
    asUser(USER_A); seed()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await (await deleteCard()).json()).toEqual({ removed: true })
    expect(db.rows('payment_cards')).toHaveLength(0)
    asUser(null)
    expect((await deleteCard()).status).toBe(401)
  })
})
