/**
 * GET /api/admin/reports/free-swings — does the free swing pay for itself?
 *
 * What is pinned here is the denominator. The seven-day conversion rate is a
 * share of the swings whose week has closed, not of everyone who has ever
 * taken one: otherwise the rate falls every time the free swing gets more
 * popular, and the number becomes a liar exactly when it matters.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, USER_A, USER_B, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'
import { GET } from '@/app/api/admin/reports/free-swings/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

const USER_C = '66666666-6666-4666-8666-666666666666'
const USER_D = '77777777-7777-4777-8777-777777777777'
let db: FakeDb

const asAdmin = () => {
  db.seed('profiles', { id: USER_A.id, name: 'Seed Admin', is_admin: true })
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3_600_000).toISOString()

function freeSwing(userId: string, when: string, over: Record<string, unknown> = {}) {
  return db.seed('bets', {
    user_id: userId, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_free',
    stake_pence: 0, potential_win_pence: 1_000_000, status: 'miss', created_at: when, ...over,
  })[0]
}

function paidBet(userId: string, when: string, stakeCents = 5000) {
  return db.seed('bets', {
    user_id: userId, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1',
    stake_pence: stakeCents, potential_win_pence: 2_500_000, status: 'miss', created_at: when,
  })[0]
}

const report = async () => (await GET()).json()

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  asAdmin()
})
afterEach(() => vi.restoreAllMocks())

describe('access', () => {
  it('401 without an admin session', async () => {
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: null }))
    expect((await GET()).status).toBe(401)
  })

  it('403 for a signed-in non-admin', async () => {
    db.seed('profiles', { id: USER_B.id, is_admin: false })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_B }))
    expect((await GET()).status).toBe(403)
  })
})

describe('the seven-day rate', () => {
  it('counts only swings whose week has closed, and says how many are still pending', async () => {
    freeSwing(USER_B.id, daysAgo(20)); paidBet(USER_B.id, daysAgo(18))   // converted in time
    freeSwing(USER_C, daysAgo(20))                                        // matured, never staked
    freeSwing(USER_D, daysAgo(2))                                         // still inside its week

    const r = await report()
    expect(r).toMatchObject({
      taken: 3,
      matured: 2,
      pending: 1,
      converted7d: 1,
      conversionRate7d: '50.0',   // 1 of the 2 matured, not 1 of 3
    })
  })

  it('a golfer who staked on day 9 counts as converted ever, but not within the week', async () => {
    freeSwing(USER_B.id, daysAgo(30)); paidBet(USER_B.id, daysAgo(21))
    const r = await report()
    expect(r).toMatchObject({ matured: 1, converted7d: 0, conversionRate7d: '0.0', convertedEver: 1, conversionRateEver: '100.0' })
  })

  it('a stake placed before the free swing does not count as conversion', async () => {
    paidBet(USER_B.id, daysAgo(30))
    freeSwing(USER_B.id, daysAgo(20))
    const r = await report()
    expect(r).toMatchObject({ taken: 1, convertedEver: 0, converted7d: 0, revenueAfterFreeCents: 0 })
  })

  it('no rate at all rather than a fake zero when nothing has matured', async () => {
    freeSwing(USER_B.id, daysAgo(1))
    const r = await report()
    expect(r).toMatchObject({ taken: 1, matured: 0, pending: 1, conversionRate7d: null })
  })

  it('is all zeros and no rates on an empty table', async () => {
    const r = await report()
    expect(r).toMatchObject({ taken: 0, matured: 0, converted7d: 0, conversionRate7d: null, conversionRateEver: null, weeks: [] })
  })
})

describe('what a free swing is worth', () => {
  it('counts the stakes that followed it, per swing', async () => {
    freeSwing(USER_B.id, daysAgo(20)); paidBet(USER_B.id, daysAgo(18), 5000); paidBet(USER_B.id, daysAgo(10), 25000)
    freeSwing(USER_C, daysAgo(20))
    const r = await report()
    expect(r).toMatchObject({
      paidBetsAfterFree: 2,
      revenueAfterFreeCents: 30000,
      revenuePerFreeSwingCents: 15000,   // R300 of stakes across two free swings
    })
  })

  it('reports the prize exposure from free swings that went in', async () => {
    freeSwing(USER_B.id, daysAgo(9), { status: 'claimed' })
    freeSwing(USER_C, daysAgo(9), { status: 'miss' })
    const r = await report()
    expect(r).toMatchObject({ claimed: 1, prizeExposureCents: 1_000_000 })
  })

  it('reports the median wait to the first stake', async () => {
    freeSwing(USER_B.id, daysAgo(20)); paidBet(USER_B.id, daysAgo(19))   // ~24h
    const r = await report()
    expect(r.medianHoursToFirstPaid).toBeGreaterThan(23)
    expect(r.medianHoursToFirstPaid).toBeLessThan(25)
  })
})

describe('the weekly trend', () => {
  it('groups by week, newest first, each with its own rate against its own matured count', async () => {
    freeSwing(USER_B.id, daysAgo(30)); paidBet(USER_B.id, daysAgo(28))
    freeSwing(USER_C, daysAgo(30))
    freeSwing(USER_D, daysAgo(1))
    const r = await report()
    expect(r.weeks.length).toBeGreaterThanOrEqual(2)
    expect(r.weeks[0].weekStart >= r.weeks[r.weeks.length - 1].weekStart).toBe(true)
    const totals = r.weeks.reduce((s: number, w: { taken: number }) => s + w.taken, 0)
    expect(totals).toBe(3)
    // This week's swing has not matured, so it has no rate to show yet.
    const thisWeek = r.weeks[0]
    expect(thisWeek.matured === 0 ? thisWeek.rate : 'has-a-rate').toBe(thisWeek.matured === 0 ? null : 'has-a-rate')
  })
})
