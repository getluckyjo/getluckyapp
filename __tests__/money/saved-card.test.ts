/**
 * Saved cards (PayFast tokenization, migration 021).
 *
 * The API signature, the one-call charge (/api/payments/payfast/charge)
 * and the card endpoints (/api/payments/card). Money invariants: the
 * ledger row exists before PayFast is asked; a refusal leaves 'failed' and
 * no bet; a success leaves 'complete' and a bet on the hole the golfer
 * chose, granted on the same rules as any other payment; no answer leaves
 * 'unknown', never 'failed', so a late ITN cannot turn into a second
 * payment. A saved card is bounded: stakes to R250, R2,500 a day.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID, type FakeUser } from '../helpers/fake-supabase'
import { apiSignature, apiTimestamp, queryTransaction, refundPayment } from '@/lib/payfast/api'
import { SAVED_CARD_DAILY_CAP_CENTS } from '@/lib/payfast/saved-card'
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

  it('409 CHARGE_UNKNOWN when PayFast gives no answer: the row is unknown (never failed), no bet, and the golfer is told to check before paying again', async () => {
    asUser(USER_A); seed()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('The operation was aborted due to timeout') }))
    const res = await post(good)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('CHARGE_UNKNOWN')
    expect(json.error).toMatch(/could not confirm the charge/i)
    expect(json.m_payment_id).toMatch(/^gl_/)
    const [row] = db.rows('payfast_payments')
    expect(row).toMatchObject({ status: 'unknown', hole_id: HOLE_ID, raw_payload: { source: 'saved_card' } })
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('a timeout does not overwrite a row the ITN completed in the meantime', async () => {
    asUser(USER_A); seed()
    vi.stubGlobal('fetch', vi.fn(async () => {
      // PayFast charged and its ITN wrote 'complete' before our request gave up.
      const row = db.rows('payfast_payments')[0]
      Object.assign(row, { status: 'complete', pf_payment_id: '2200009' })
      throw new Error('timeout')
    }))
    const res = await post(good)
    expect(res.status).toBe(409)
    expect(db.rows('payfast_payments')[0]).toMatchObject({ status: 'complete', pf_payment_id: '2200009' })
  })

  it('403 SAVED_CARD_LIMIT for a stake over R250, before the ledger or PayFast is touched', async () => {
    asUser(USER_A); seed()
    const fetchMock = payfastOk()
    vi.stubGlobal('fetch', fetchMock)
    for (const tier of ['tier_4', 'tier_5']) {
      const res = await post({ ...good, tier })
      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.code).toBe('SAVED_CARD_LIMIT')
      expect(json.error).toMatch(/R250/)
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.rows('payfast_payments')).toHaveLength(0)
    // R250 itself is allowed.
    expect((await post({ ...good, tier: 'tier_3' })).status).toBe(200)
  })

  it('403 SAVED_CARD_LIMIT once R2,500 of saved-card charges sit in the last 24 hours, counting pending and unknown but not failed, checkout or older rows', async () => {
    asUser(USER_A); seed()
    const recent = new Date(Date.now() - 3_600_000).toISOString()
    const old = new Date(Date.now() - 25 * 3_600_000).toISOString()
    const row = (m: string, over: Record<string, unknown>) => db.seed('payfast_payments', {
      m_payment_id: m, user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_5', amount_cents: 100_000,
      status: 'complete', raw_payload: { source: 'saved_card' }, created_at: recent, ...over,
    })
    // Not counted: a declined charge, a checkout payment, yesterday's charge, someone else's.
    row('gl_failed', { status: 'failed' })
    row('gl_checkout', { raw_payload: { payment_status: 'COMPLETE' } })
    row('gl_old', { created_at: old })
    row('gl_other', { user_id: USER_B.id })
    // Counted: R1,000 complete + R1,000 unknown + R450 pending = R2,450. A R50 charge fits exactly; a R100 one does not.
    row('gl_c1', {})
    row('gl_c2', { status: 'unknown' })
    row('gl_c3', { status: 'pending', amount_cents: 45_000 })
    const fetchMock = payfastOk()
    vi.stubGlobal('fetch', fetchMock)
    const over = await post({ ...good, tier: 'tier_2' })
    expect(over.status).toBe(403)
    const json = await over.json()
    expect(json.code).toBe('SAVED_CARD_LIMIT')
    expect(json.error).toMatch(/2[,\u00a0 ]?500/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.rows('payfast_payments')).toHaveLength(7)

    expect((await post(good)).status).toBe(200)   // R50: 245,000 + 5,000 = the cap, allowed
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(SAVED_CARD_DAILY_CAP_CENTS).toBe(250_000)
    expect((await post(good)).status).toBe(403)   // and now over it
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

const CSV_HEADER = 'Date,Type,Sign,Party,Name,Description,Currency,"Funding Type",Gross,Fee,Net,Balance,"M Payment ID","PF Payment ID","custom str1","custom int1","custom str2","custom int2","custom str3","custom str4","custom str5","custom int3","custom int4","custom int5"'
const csvRow = (ref: string, pf: string, gross = '50.00') => `"2026-09-17 08:00:00",FUNDS_RECEIVED,CREDIT,"Alice Ace","Get Lucky Golf - R50 Entry",,ZAR,CC,${gross},-2.30,47.70,"22,574.02",${ref},${pf},,,,,,,,,,`
const CONFIG = { merchantId: '10012345', passphrase: 'unit-test-passphrase', sandbox: true }

describe('queryTransaction', () => {
  it('signs the query fields, asks for the day before the charge to the day after today, and finds our reference in the CSV', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ response: `${CSV_HEADER}\n${csvRow('gl_other', '1')}\n${csvRow('gl_mine', '994209')}` }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const found = await queryTransaction(CONFIG, 'gl_mine', { chargedAt: new Date('2026-09-17T08:00:00Z'), now: new Date('2026-09-17T08:03:00Z') })
    expect(found).toEqual({ found: true, pfPaymentId: '994209', amountCents: 5000, type: 'FUNDS_RECEIVED', date: '2026-09-17 08:00:00' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.payfast.co.za/transactions/history?from=2026-09-16&to=2026-09-18&testing=true')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    const headers = init.headers as Record<string, string>
    expect(headers.signature).toBe(apiSignature({ 'merchant-id': '10012345', version: 'v1', timestamp: headers.timestamp, from: '2026-09-16', to: '2026-09-18' }, 'unit-test-passphrase'))
  })

  it('reports not found when the CSV has no such reference, and throws on anything that is not the transaction CSV', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ response: `${CSV_HEADER}\n${csvRow('gl_other', '1')}` }))))
    expect(await queryTransaction(CONFIG, 'gl_mine', { chargedAt: new Date() })).toEqual({ found: false })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ response: CSV_HEADER }))))
    expect(await queryTransaction(CONFIG, 'gl_mine', { chargedAt: new Date() })).toEqual({ found: false })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 401, status: 'failed', data: { message: 'Invalid signature' } }), { status: 401 })))
    await expect(queryTransaction(CONFIG, 'gl_mine', { chargedAt: new Date() })).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 200, status: 'success', data: { response: false } }))))
    await expect(queryTransaction(CONFIG, 'gl_mine', { chargedAt: new Date() })).rejects.toThrow()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(queryTransaction(CONFIG, 'gl_mine', { chargedAt: new Date() })).rejects.toThrow()
  })
})

describe('refundPayment', () => {
  it('posts the amount in cents and the reason to /refunds/{pf_payment_id}, signed', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 200, status: 'success', data: { response: true, message: 'Success' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await refundPayment(CONFIG, '2200001', 5000, 'Charged twice')
    expect(result.ok).toBe(true)
    expect(result.refundId).toBeNull()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.payfast.co.za/refunds/2200001?testing=true')
    expect(init.method).toBe('POST')
    const body = Object.fromEntries(new URLSearchParams(String(init.body)))
    expect(body).toEqual({ amount: '5000', reason: 'Charged twice', notify_buyer: '1', notify_merchant: '0' })
    const headers = init.headers as Record<string, string>
    expect(headers.signature).toBe(apiSignature({ 'merchant-id': '10012345', version: 'v1', timestamp: headers.timestamp, ...body }, 'unit-test-passphrase'))
  })

  it('reads a refusal as not ok, and a refund id when PayFast gives one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 400, status: 'failed', data: { response: false, message: 'Refund amount exceeds available balance' } }), { status: 400 })))
    const refused = await refundPayment(CONFIG, '2200001', 5000, 'Charged twice')
    expect(refused).toMatchObject({ ok: false, status: 400, message: 'Refund amount exceeds available balance', refundId: null })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 200, status: 'success', data: { response: { refund_id: 'rf_77' } } }))))
    expect((await refundPayment(CONFIG, '2200001', 5000, 'Charged twice')).refundId).toBe('rf_77')
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
