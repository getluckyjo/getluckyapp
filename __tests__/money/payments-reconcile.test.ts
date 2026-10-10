/**
 * Settling saved-card charges PayFast never answered for (migration 037).
 *
 * An 'unknown' row is money that may or may not have moved. The
 * reconciliation asks PayFast's transaction history and moves the row to
 * complete (and grants the bet), amount_mismatch, or failed; when PayFast
 * cannot be asked, the row stays unknown. It runs inside the outbox cron.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { FakeDb, createFakeClient, USER_A, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'
import { reconcileUnknownPayments, reconcileMissingPayments, RECONCILE_AFTER_MS } from '@/lib/payfast/reconcile'
import { GET as cron } from '@/app/api/cron/outbox/route'
import { GET as sweepCron } from '@/app/api/cron/reconcile/route'

const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => adminClient)

const CONFIG = { merchantId: '10012345', passphrase: 'unit-test-passphrase', sandbox: true }
const CSV_HEADER = 'Date,Type,Sign,Party,Name,Description,Currency,"Funding Type",Gross,Fee,Net,Balance,"M Payment ID","PF Payment ID","custom str1","custom int1","custom str2","custom int2","custom str3","custom str4","custom str5","custom int3","custom int4","custom int5"'
const csvRow = (ref: string, pf: string, gross = '50.00') => `"2026-09-17 08:00:00",FUNDS_RECEIVED,CREDIT,"Alice Ace","Get Lucky Golf - R50 Entry",,ZAR,CC,${gross},-2.30,47.70,"22,574.02",${ref},${pf},,,,,,,,,,`
const history = (...rows: string[]) => vi.fn(async () => new Response(JSON.stringify({ response: [CSV_HEADER, ...rows].join('\n') }), { status: 200 }))
/** A hosted-checkout payment as PayFast lists it: our custom fields carry user, course, hole and tier. PayFast's clock is SAST. */
const paidRow = (ref: string, pf: string, over: { date?: string; gross?: string; user?: string; course?: string; hole?: string; tier?: string } = {}) =>
  `"${over.date ?? '2026-09-17 08:00:00'}",FUNDS_RECEIVED,CREDIT,"Alice Ace","Get Lucky Golf - R50 Entry",,ZAR,CC,${over.gross ?? '50.00'},-2.30,47.70,"22,574.02",${ref},${pf},${over.user ?? USER_A.id},,${over.course ?? COURSE_ID},,${over.hole ?? HOLE_ID},${over.tier ?? 'tier_1'},,,,`

const NOW = new Date('2026-09-17T08:10:00Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

let db: FakeDb
const admin = () => createFakeClient(db) as unknown as SupabaseClient<Database>

function unknownRow(over: Record<string, unknown> = {}) {
  return db.seed('payfast_payments', {
    m_payment_id: 'gl_unknown', pf_payment_id: null, user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID,
    tier: 'tier_1', amount_cents: 5000, status: 'unknown', bet_id: null, raw_payload: { source: 'saved_card', error: 'timeout' },
    created_at: minutesAgo(5), ...over,
  })[0]
}

beforeEach(() => {
  db = new FakeDb()
  db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek', is_partner: true })
  db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 4, par: 3, distance_metres: 165, is_active: true })
  db.seed('profiles', { id: USER_A.id, age_verified_at: '2026-01-01T00:00:00Z', total_attempts: 0 })
  adminClient.createAdminClient.mockImplementation(() => admin())
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('reconcileUnknownPayments', () => {
  it('leaves a row younger than two minutes alone: the ITN gets its chance first', async () => {
    unknownRow({ created_at: new Date(NOW.getTime() - RECONCILE_AFTER_MS + 1000).toISOString() })
    const fetchMock = history(csvRow('gl_unknown', '994209'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await reconcileUnknownPayments(admin(), CONFIG, { now: NOW })).toEqual({ checked: 0, completed: 0, mismatched: 0, failed: 0, left: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.rows('payfast_payments')[0].status).toBe('unknown')
  })

  it('found at PayFast for the right amount: complete, PayFast id attached, bet granted on the chosen hole', async () => {
    unknownRow()
    vi.stubGlobal('fetch', history(csvRow('gl_other', '1'), csvRow('gl_unknown', '994209')))
    expect(await reconcileUnknownPayments(admin(), CONFIG, { now: NOW })).toEqual({ checked: 1, completed: 1, mismatched: 0, failed: 0, left: 0 })
    const [row] = db.rows('payfast_payments')
    expect(row).toMatchObject({ status: 'complete', pf_payment_id: '994209' })
    expect(row.raw_payload).toMatchObject({ source: 'saved_card', reconciled: 'found' })
    const [bet] = db.rows('bets')
    expect(bet).toMatchObject({ user_id: USER_A.id, hole_id: HOLE_ID, tier: 'tier_1', stake_pence: 5000, status: 'active', payment_intent_id: 'gl_unknown', pf_payment_id: '994209' })
    expect(row.bet_id).toBe(bet.id)
  })

  it('is idempotent: a second run finds nothing to do and the bet is not made twice', async () => {
    unknownRow()
    vi.stubGlobal('fetch', history(csvRow('gl_unknown', '994209')))
    await reconcileUnknownPayments(admin(), CONFIG, { now: NOW })
    expect(await reconcileUnknownPayments(admin(), CONFIG, { now: NOW })).toMatchObject({ checked: 0 })
    expect(db.rows('bets')).toHaveLength(1)
  })

  it('not found at PayFast: failed, so the golfer may pay again, and no bet', async () => {
    unknownRow()
    vi.stubGlobal('fetch', history(csvRow('gl_other', '1')))
    expect(await reconcileUnknownPayments(admin(), CONFIG, { now: NOW })).toMatchObject({ checked: 1, failed: 1 })
    const [row] = db.rows('payfast_payments')
    expect(row.status).toBe('failed')
    expect(row.raw_payload).toMatchObject({ source: 'saved_card', reconciled: 'not_found' })
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('found for another amount: amount_mismatch, no bet', async () => {
    unknownRow()
    vi.stubGlobal('fetch', history(csvRow('gl_unknown', '994209', '100.00')))
    expect(await reconcileUnknownPayments(admin(), CONFIG, { now: NOW })).toMatchObject({ checked: 1, mismatched: 1, completed: 0 })
    expect(db.rows('payfast_payments')[0]).toMatchObject({ status: 'amount_mismatch', pf_payment_id: '994209' })
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('PayFast unreachable, or answering something other than the CSV: the row stays unknown for the next run', async () => {
    unknownRow()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await reconcileUnknownPayments(admin(), CONFIG, { now: NOW })).toMatchObject({ checked: 1, left: 1, failed: 0 })
    expect(db.rows('payfast_payments')[0].status).toBe('unknown')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 401, status: 'failed', data: { message: 'Invalid signature' } }), { status: 401 })))
    expect(await reconcileUnknownPayments(admin(), CONFIG, { now: NOW })).toMatchObject({ checked: 1, left: 1 })
    expect(db.rows('payfast_payments')[0].status).toBe('unknown')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('only unknown rows are looked at, oldest first, up to the limit', async () => {
    unknownRow({ m_payment_id: 'gl_pending', status: 'pending' })
    unknownRow({ m_payment_id: 'gl_failed', status: 'failed' })
    unknownRow({ m_payment_id: 'gl_complete', status: 'complete' })
    unknownRow({ m_payment_id: 'gl_u_new', created_at: minutesAgo(3) })
    unknownRow({ m_payment_id: 'gl_u_old', created_at: minutesAgo(30) })
    const fetchMock = history(csvRow('gl_u_old', '1'), csvRow('gl_u_new', '2'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await reconcileUnknownPayments(admin(), CONFIG, { now: NOW, limit: 1 })).toMatchObject({ checked: 1, completed: 1 })
    expect(db.find('payfast_payments', r => r.m_payment_id === 'gl_u_old')!.status).toBe('complete')
    expect(db.find('payfast_payments', r => r.m_payment_id === 'gl_u_new')!.status).toBe('unknown')
    for (const ref of ['gl_pending', 'gl_failed', 'gl_complete']) {
      expect(db.find('payfast_payments', r => r.m_payment_id === ref)!.status).toBe(ref.slice(3))
    }
  })
})

describe('GET /api/cron/outbox runs the reconciliation', () => {
  const call = () => cron(new Request('http://x/api/cron/outbox', { headers: { authorization: 'Bearer s3cret' } }) as never)

  it('settles unknown rows alongside the drain when PayFast is configured', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    vi.stubEnv('PAYFAST_MERCHANT_ID', '10012345'); vi.stubEnv('PAYFAST_MERCHANT_KEY', 'k'); vi.stubEnv('PAYFAST_PASSPHRASE', 'unit-test-passphrase')
    vi.stubEnv('PAYFAST_SANDBOX', 'true'); vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.example.com'); vi.stubEnv('VERCEL_ENV', 'preview')
    unknownRow()
    vi.stubGlobal('fetch', history(csvRow('gl_unknown', '994209')))
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ claimed: 0, reconcile: { checked: 1, completed: 1 } })
    expect(db.rows('payfast_payments')[0].status).toBe('complete')
    expect(db.rows('bets')).toHaveLength(1)
  })

  it('skips the reconciliation, and still drains, when PayFast is not configured', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    vi.stubEnv('PAYFAST_MERCHANT_ID', '')
    unknownRow()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ reconcile: { skipped: 'payfast_misconfigured' } })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.rows('payfast_payments')[0].status).toBe('unknown')
  })
})

describe('reconcileMissingPayments: the ledger against PayFast history', () => {
  it('a payment PayFast has and the ledger does not gets its row, its bet, and an ops alert', async () => {
    vi.stubGlobal('fetch', history(paidRow('gl_lost', '994300')))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await reconcileMissingPayments(admin(), CONFIG, { now: NOW })).toEqual({ seen: 1, recorded: 1, mismatched: 0, granted: 1, errors: 0 })
    const [row] = db.rows('payfast_payments')
    expect(row).toMatchObject({ m_payment_id: 'gl_lost', pf_payment_id: '994300', user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', amount_cents: 5000, status: 'complete' })
    expect(row.raw_payload).toMatchObject({ source: 'reconcile_history' })
    const [bet] = db.rows('bets')
    expect(bet).toMatchObject({ user_id: USER_A.id, hole_id: HOLE_ID, tier: 'tier_1', stake_pence: 5000, status: 'active', payment_intent_id: 'gl_lost' })
    expect(row.bet_id).toBe(bet.id)
    expect(errorLog.mock.calls.some(c => String(c[0]).includes('payfast.sweep.itn_missed'))).toBe(true)
  })

  it('rows the ledger already has, references that are not ours, and payments minutes old are left alone', async () => {
    db.seed('payfast_payments', { m_payment_id: 'gl_known', pf_payment_id: '1', user_id: USER_A.id, tier: 'tier_1', amount_cents: 5000, status: 'complete', raw_payload: {} })
    vi.stubGlobal('fetch', history(paidRow('gl_known', '1'), paidRow('sub_membership_9', '2'), paidRow('gl_fresh', '3', { date: '2026-09-17 10:05:00' })))
    expect(await reconcileMissingPayments(admin(), CONFIG, { now: NOW })).toEqual({ seen: 2, recorded: 0, mismatched: 0, granted: 0, errors: 0 })
    expect(db.rows('payfast_payments')).toHaveLength(1)
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('a found payment for the wrong amount is recorded as amount_mismatch with no bet', async () => {
    vi.stubGlobal('fetch', history(paidRow('gl_short', '7', { gross: '20.00' })))
    expect(await reconcileMissingPayments(admin(), CONFIG, { now: NOW })).toEqual({ seen: 1, recorded: 1, mismatched: 1, granted: 0, errors: 0 })
    expect(db.rows('payfast_payments')[0]).toMatchObject({ status: 'amount_mismatch', tier: null, amount_cents: 2000 })
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('is idempotent across runs', async () => {
    vi.stubGlobal('fetch', history(paidRow('gl_lost', '994300')))
    await reconcileMissingPayments(admin(), CONFIG, { now: NOW })
    expect(await reconcileMissingPayments(admin(), CONFIG, { now: NOW })).toEqual({ seen: 1, recorded: 0, mismatched: 0, granted: 0, errors: 0 })
    expect(db.rows('payfast_payments')).toHaveLength(1)
    expect(db.rows('bets')).toHaveLength(1)
  })

  it('an answer that is not the transaction CSV throws rather than reading as "nothing happened"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Service Unavailable', { status: 503 })))
    await expect(reconcileMissingPayments(admin(), CONFIG, { now: NOW })).rejects.toThrow(/503/)
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })
})

describe('GET /api/cron/reconcile', () => {
  const call = (auth?: string) => sweepCron(new Request('http://x/api/cron/reconcile', { headers: auth ? { authorization: auth } : {} }) as never)

  it('refuses without the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    expect((await call()).status).toBe(401)
    vi.stubEnv('CRON_SECRET', '')
    expect((await call('Bearer anything')).status).toBe(503)
  })

  it('runs the sweep when PayFast is configured, and says so when it is not', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    vi.stubEnv('PAYFAST_MERCHANT_ID', '10012345'); vi.stubEnv('PAYFAST_MERCHANT_KEY', 'k'); vi.stubEnv('PAYFAST_PASSPHRASE', 'unit-test-passphrase')
    vi.stubEnv('PAYFAST_SANDBOX', 'true'); vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.example.com'); vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubGlobal('fetch', history(paidRow('gl_lost', '994300')))
    const res = await call('Bearer s3cret')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ seen: 1, recorded: 1, granted: 1 })

    vi.stubEnv('PAYFAST_MERCHANT_ID', '')
    expect(await (await call('Bearer s3cret')).json()).toEqual({ skipped: 'payfast_misconfigured' })
  })
})
