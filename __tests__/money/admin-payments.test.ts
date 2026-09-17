/**
 * The admin's view of the money: the PayFast ledger list and the bet screen.
 *
 * What is pinned here is what an admin acts on: a complete payment with no
 * bet is the golfer who paid and has nothing to play, and it must surface
 * whether or not the ledger's own bet_id link was ever written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, USER_A, USER_B, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

import { GET as listPayments } from '@/app/api/admin/payments/route'
import { GET as getBet } from '@/app/api/admin/bets/[betId]/route'

const BET_ID = '33333333-3333-4333-8333-333333333333'
let db: FakeDb

const asAdmin = () => {
  db.seed('profiles', { id: USER_A.id, name: 'Seed Admin', email: 'admin@x.co.za', is_admin: true })
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
}
const asGolfer = () => {
  db.seed('profiles', { id: USER_B.id, name: 'Alice Ace', email: 'alice@x.co.za', age_verified_at: '2026-01-01T00:00:00Z', total_attempts: 3 })
}
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
const list = (qs = '') => listPayments(new Request(`http://x/api/admin/payments${qs}`) as never)

function ledger(over: Record<string, unknown> = {}) {
  return db.seed('payfast_payments', {
    m_payment_id: 'gl_one', pf_payment_id: '900001', user_id: USER_B.id,
    course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', amount_cents: 5000,
    status: 'complete', bet_id: null, raw_payload: {}, created_at: '2026-09-17T08:00:00Z', ...over,
  })[0]
}

beforeEach(() => {
  db = new FakeDb()
  db.seed('courses', { id: COURSE_ID, name: 'Arabella Golf Club', is_partner: true })
  db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 5, par: 3, distance_metres: 161, is_active: true })
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('GET /api/admin/payments', () => {
  it('401 without a session, 403 without the admin flag', async () => {
    serverClient.createClient.mockResolvedValue(createFakeClient(db, {}))
    expect((await list()).status).toBe(401)
    db.seed('profiles', { id: USER_B.id, is_admin: false })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_B }))
    expect((await list()).status).toBe(403)
  })

  it('lists payments with the golfer, the hole, how it was paid and the bet it made', async () => {
    asAdmin(); asGolfer()
    ledger({ bet_id: BET_ID, raw_payload: { source: 'saved_card' } })
    const { data } = await (await list()).json()
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      mPaymentId: 'gl_one', pfPaymentId: '900001', userName: 'Alice Ace', userEmail: 'alice@x.co.za',
      courseName: 'Arabella Golf Club', holeNumber: 5, amountCents: 5000, status: 'complete',
      source: 'saved_card', betId: BET_ID,
    })
  })

  it('finds the bet by reference when the ledger link was never written', async () => {
    asAdmin(); asGolfer()
    ledger()   // bet_id null
    db.seed('bets', { id: BET_ID, user_id: USER_B.id, payment_intent_id: 'gl_one', status: 'active' })
    const { data } = await (await list()).json()
    expect(data[0].betId).toBe(BET_ID)
  })

  it('a complete payment with no bet anywhere stays unmatched: the case needing a person', async () => {
    asAdmin(); asGolfer()
    ledger()
    const { data } = await (await list()).json()
    expect(data[0].betId).toBeNull()

    const onlyUnmatched = await (await list('?unmatched=true')).json()
    expect(onlyUnmatched.data.map((p: { mPaymentId: string }) => p.mPaymentId)).toEqual(['gl_one'])
  })

  it('unmatched excludes failed and pending charges: nothing was taken', async () => {
    asAdmin(); asGolfer()
    ledger({ m_payment_id: 'gl_failed', status: 'failed' })
    ledger({ m_payment_id: 'gl_pending', status: 'pending' })
    const { data } = await (await list('?unmatched=true')).json()
    expect(data).toHaveLength(0)
  })

  it('filters by status', async () => {
    asAdmin(); asGolfer()
    ledger({ m_payment_id: 'gl_ok' })
    ledger({ m_payment_id: 'gl_bad', status: 'failed' })
    const { data } = await (await list('?status=failed')).json()
    expect(data.map((p: { mPaymentId: string }) => p.mPaymentId)).toEqual(['gl_bad'])
  })

  it('a checkout payment is not labelled as a saved card', async () => {
    asAdmin(); asGolfer()
    ledger({ raw_payload: { payment_status: 'COMPLETE' } })
    const { data } = await (await list()).json()
    expect(data[0].source).toBe('checkout')
  })
})

describe('GET /api/admin/bets/[betId]', () => {
  function seedBet(over: Record<string, unknown> = {}) {
    return db.seed('bets', {
      id: BET_ID, user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID,
      tier: 'tier_1', stake_pence: 5000, potential_win_pence: 2_500_000, status: 'active',
      declared_result: null, payment_intent_id: 'gl_one', video_url: null,
      created_at: '2026-09-17T08:00:00Z', risk_score: 0, risk_flags: null, ...over,
    })[0]
  }

  it('404s on a non-UUID rather than querying', async () => {
    asAdmin()
    expect((await getBet(new Request('http://x') as never, params({ betId: 'not-a-uuid' }))).status).toBe(404)
  })

  it('returns the bet with its payment, its golfer and its history', async () => {
    asAdmin(); asGolfer()
    seedBet()
    ledger({ bet_id: BET_ID })
    db.seed('claim_events', { id: 1, bet_id: BET_ID, table_name: 'bets', action: 'insert', actor_role: 'player', actor_id: USER_B.id, changed: null, created_at: '2026-09-17T08:00:01Z' })

    const res = await getBet(new Request('http://x') as never, params({ betId: BET_ID }))
    expect(res.status).toBe(200)
    const detail = await res.json()
    expect(detail).toMatchObject({
      id: BET_ID, courseName: 'Arabella Golf Club', holeNumber: 5, tier: 'tier_1', status: 'active',
    })
    expect(detail.payment).toMatchObject({ mPaymentId: 'gl_one', amountCents: 5000, status: 'complete' })
    expect(detail.user).toMatchObject({ name: 'Alice Ace', ageVerifiedAt: '2026-01-01T00:00:00Z', totalAttempts: 3, suspendedAt: null })
    expect(detail.events).toHaveLength(1)
  })

  it('says plainly when a bet has no payment on record', async () => {
    asAdmin(); asGolfer()
    seedBet({ payment_intent_id: 'gl_missing' })
    const detail = await (await getBet(new Request('http://x') as never, params({ betId: BET_ID }))).json()
    expect(detail.payment).toBeNull()
  })

  it('carries the risk flags and the claim through to the screen', async () => {
    asAdmin(); asGolfer()
    seedBet({ status: 'claimed', declared_result: 'win', risk_score: 40, risk_flags: [{ rule: 'first_bet_win', severity: 'medium', detail: { first_bet: true } }] })
    db.seed('verifications', { id: '44444444-4444-4444-8444-444444444444', bet_id: BET_ID, status: 'under_review' })
    const detail = await (await getBet(new Request('http://x') as never, params({ betId: BET_ID }))).json()
    expect(detail.riskScore).toBe(40)
    expect(detail.riskFlags[0].rule).toBe('first_bet_win')
    expect(detail.verificationStatus).toBe('under_review')
  })
})
