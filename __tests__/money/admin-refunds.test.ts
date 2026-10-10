/**
 * POST /api/admin/payments/[mPaymentId]/refund (migration 037).
 *
 * Money goes back to a golfer only on an admin's say, only for a payment
 * that took it, never while a claim on it is open or paid, and every
 * attempt is on record: requested before PayFast is asked, then sent or
 * failed. The bet is never touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'
import { apiSignature } from '@/lib/payfast/api'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

import { POST as refund } from '@/app/api/admin/payments/[mPaymentId]/refund/route'
import { GET as listPayments } from '@/app/api/admin/payments/route'

const BET_ID = '33333333-3333-4333-8333-333333333333'
let db: FakeDb

function env(over: Record<string, string | undefined> = {}) {
  vi.unstubAllEnvs()
  const base: Record<string, string | undefined> = {
    PAYFAST_MERCHANT_ID: '10012345', PAYFAST_MERCHANT_KEY: 'sandboxkey123', PAYFAST_PASSPHRASE: 'unit-test-passphrase',
    PAYFAST_SANDBOX: 'true', NEXT_PUBLIC_SITE_URL: 'https://preview.example.com', VERCEL_ENV: 'preview', ...over,
  }
  for (const [k, v] of Object.entries(base)) if (v !== undefined) vi.stubEnv(k, v)
}
const asAdmin = () => {
  db.seed('profiles', { id: USER_A.id, name: 'Seed Admin', email: 'admin@x.co.za', is_admin: true })
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
}
const asGolfer = () => db.seed('profiles', { id: USER_B.id, name: 'Alice Ace', email: 'alice@x.co.za', age_verified_at: '2026-01-01T00:00:00Z', total_attempts: 3 })

function ledger(over: Record<string, unknown> = {}) {
  return db.seed('payfast_payments', {
    m_payment_id: 'gl_one', pf_payment_id: '900001', user_id: USER_B.id,
    course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', amount_cents: 5000,
    status: 'complete', bet_id: null, raw_payload: {}, refunded_at: null, created_at: '2026-09-17T08:00:00Z', ...over,
  })[0]
}
const bet = (status: string, over: Record<string, unknown> = {}) =>
  db.seed('bets', { id: BET_ID, user_id: USER_B.id, payment_intent_id: 'gl_one', status, ...over })[0]

const payfastOk = () => vi.fn(async () => new Response(JSON.stringify({ code: 200, status: 'success', data: { response: true, message: 'Success' } }), { status: 200 }))
const post = (mPaymentId: string, body: unknown = { reason: 'Charged twice after a timeout' }) =>
  refund(jsonRequest(`http://x/api/admin/payments/${mPaymentId}/refund`, body) as never, { params: Promise.resolve({ mPaymentId }) })

beforeEach(() => {
  db = new FakeDb()
  env()
  db.seed('courses', { id: COURSE_ID, name: 'Arabella Golf Club', is_partner: true })
  db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 5, par: 3, distance_metres: 161, is_active: true })
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.stubGlobal('fetch', payfastOk())
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('POST /api/admin/payments/[mPaymentId]/refund', () => {
  it('401 without a session, 403 without the admin flag; nothing is sent', async () => {
    const fetchMock = payfastOk()
    vi.stubGlobal('fetch', fetchMock)
    ledger()
    serverClient.createClient.mockResolvedValue(createFakeClient(db, {}))
    expect((await post('gl_one')).status).toBe(401)
    db.seed('profiles', { id: USER_B.id, is_admin: false })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_B }))
    expect((await post('gl_one')).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.rows('refunds')).toHaveLength(0)
  })

  it('400 without a usable reason; 404 for a reference that is not on the ledger', async () => {
    asAdmin(); asGolfer(); ledger()
    expect((await post('gl_one', { reason: 'no' })).status).toBe(400)
    expect((await post('gl_one', {})).status).toBe(400)
    expect((await post('gl_nope')).status).toBe(404)
    expect((await post('not a ref!')).status).toBe(404)
    expect(db.rows('refunds')).toHaveLength(0)
  })

  it('refunds a complete payment: refunds row sent, refunded_at stamped, PayFast asked in cents with the reason, bet untouched', async () => {
    asAdmin(); asGolfer()
    ledger({ bet_id: BET_ID })
    const active = bet('active')
    const fetchMock = payfastOk()
    vi.stubGlobal('fetch', fetchMock)
    const res = await post('gl_one')
    expect(res.status).toBe(200)
    const { refund: r } = await res.json()
    expect(r).toMatchObject({ status: 'sent', amountCents: 5000, pfRefundId: null })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.payfast.co.za/refunds/900001?testing=true')
    const body = Object.fromEntries(new URLSearchParams(String(init.body)))
    expect(body).toMatchObject({ amount: '5000', reason: 'Charged twice after a timeout' })
    const headers = init.headers as Record<string, string>
    expect(headers.signature).toBe(apiSignature({ 'merchant-id': '10012345', version: 'v1', timestamp: headers.timestamp, ...body }, 'unit-test-passphrase'))

    const [row] = db.rows('refunds')
    expect(row).toMatchObject({ m_payment_id: 'gl_one', pf_payment_id: '900001', amount_cents: 5000, reason: 'Charged twice after a timeout', status: 'sent', requested_by: USER_A.id })
    expect(db.rows('payfast_payments')[0].refunded_at).toBeTruthy()
    expect(db.rows('payfast_payments')[0].status).toBe('complete')
    expect(active.status).toBe('active')
  })

  it('refunds an amount mismatch too (money was taken), and a payment with no bet', async () => {
    asAdmin(); asGolfer()
    ledger({ status: 'amount_mismatch', amount_cents: 4900 })
    expect((await post('gl_one')).status).toBe(200)
    expect(db.rows('refunds')[0]).toMatchObject({ amount_cents: 4900, status: 'sent' })
  })

  it('409 for a payment that took no money (pending, failed, unknown), or has no PayFast id, or is already refunded', async () => {
    asAdmin(); asGolfer()
    const fetchMock = payfastOk()
    vi.stubGlobal('fetch', fetchMock)
    for (const status of ['pending', 'failed', 'unknown']) {
      db = new FakeDb(); asAdmin(); asGolfer(); adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
      ledger({ status })
      const res = await post('gl_one')
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('NOT_REFUNDABLE')
    }
    db = new FakeDb(); asAdmin(); asGolfer(); adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
    ledger({ pf_payment_id: null })
    expect((await (await post('gl_one')).json()).code).toBe('PAYFAST_ID_MISSING')
    db = new FakeDb(); asAdmin(); asGolfer(); adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
    ledger({ refunded_at: '2026-09-17T09:00:00Z' })
    expect((await (await post('gl_one')).json()).code).toBe('ALREADY_REFUNDED')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.rows('refunds')).toHaveLength(0)
  })

  it('409 BET_LOCKED while the bet is claimed, verified or paid, found by link or by reference', async () => {
    asAdmin(); asGolfer()
    const fetchMock = payfastOk()
    vi.stubGlobal('fetch', fetchMock)
    for (const status of ['claimed', 'verified', 'paid']) {
      db = new FakeDb(); asAdmin(); asGolfer(); adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
      ledger()              // bet_id never written: found by the reference the bet carries
      bet(status)
      const res = await post('gl_one')
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: 'BET_LOCKED', betId: BET_ID })
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.rows('refunds')).toHaveLength(0)
    // A miss, or an active bet, does not block.
    db = new FakeDb(); asAdmin(); asGolfer(); adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
    ledger({ bet_id: BET_ID }); bet('miss')
    expect((await post('gl_one')).status).toBe(200)
  })

  it('PayFast refuses: refunds row failed with what it said, payment not marked, 502 without PayFast\'s words', async () => {
    asAdmin(); asGolfer(); ledger()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 400, status: 'failed', data: { response: false, message: 'Refund amount exceeds available balance' } }), { status: 400 })))
    const res = await post('gl_one')
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.code).toBe('REFUND_FAILED')
    expect(JSON.stringify(json)).not.toContain('available balance')
    expect(db.rows('refunds')[0]).toMatchObject({ status: 'failed' })
    expect(String(db.rows('refunds')[0].failure_reason)).toContain('available balance')
    expect(db.rows('payfast_payments')[0].refunded_at).toBeNull()
  })

  it('PayFast unreachable: failed row, 502, and the admin may try again, reusing the row', async () => {
    asAdmin(); asGolfer(); ledger()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect((await post('gl_one')).status).toBe(502)
    expect(db.rows('refunds')).toHaveLength(1)
    expect(db.rows('refunds')[0].status).toBe('failed')
    vi.stubGlobal('fetch', payfastOk())
    expect((await post('gl_one')).status).toBe(200)
    expect(db.rows('refunds')).toHaveLength(1)
    expect(db.rows('refunds')[0]).toMatchObject({ status: 'sent', failure_reason: null })
    expect(db.rows('payfast_payments')[0].refunded_at).toBeTruthy()
  })

  it('a second refund of the same payment is refused', async () => {
    asAdmin(); asGolfer(); ledger()
    expect((await post('gl_one')).status).toBe(200)
    const res = await post('gl_one')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ALREADY_REFUNDED')
    expect(db.rows('refunds')).toHaveLength(1)
  })

  it('503 when PayFast is misconfigured, writing nothing', async () => {
    env({ PAYFAST_PASSPHRASE: undefined, VERCEL_ENV: 'production' })
    asAdmin(); asGolfer(); ledger()
    expect((await post('gl_one')).status).toBe(503)
    expect(db.rows('refunds')).toHaveLength(0)
  })
})

describe('GET /api/admin/payments with refunds and unknown charges', () => {
  const list = (qs = '') => listPayments(new Request(`http://x/api/admin/payments${qs}`) as never)

  it('carries refundedAt and lists unknown charges under their own status', async () => {
    asAdmin(); asGolfer()
    ledger({ refunded_at: '2026-09-17T09:00:00Z' })
    ledger({ m_payment_id: 'gl_u', pf_payment_id: null, status: 'unknown', raw_payload: { source: 'saved_card' }, created_at: '2026-09-17T09:30:00Z' })
    const { data } = await (await list()).json()
    expect(data.map((p: { mPaymentId: string; status: string; refundedAt: string | null }) => [p.mPaymentId, p.status, p.refundedAt]))
      .toEqual([['gl_u', 'unknown', null], ['gl_one', 'complete', '2026-09-17T09:00:00Z']])
    const unknown = await (await list('?status=unknown')).json()
    expect(unknown.data.map((p: { mPaymentId: string }) => p.mPaymentId)).toEqual(['gl_u'])
    // Unknown took no money yet, as far as anyone knows: not in "Paid, but no bet".
    const unmatched = await (await list('?unmatched=true')).json()
    expect(unmatched.data.map((p: { mPaymentId: string }) => p.mPaymentId)).toEqual(['gl_one'])
  })
})
