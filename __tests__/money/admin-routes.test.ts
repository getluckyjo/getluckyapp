/**
 * Admin routes after Batch 5: every input goes through a schema, every
 * failure through apiError, no mock branches, no leaked error messages.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'
import { ALL_TIERS } from '@/lib/tiers'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

import { POST as createCourse, GET as listCourses } from '@/app/api/admin/courses/route'
import { PATCH as patchCourse } from '@/app/api/admin/courses/[courseId]/route'
import { POST as createHole } from '@/app/api/admin/courses/[courseId]/holes/route'
import { PATCH as patchUser } from '@/app/api/admin/users/[userId]/route'
import { GET as listUsers } from '@/app/api/admin/users/route'
import { GET as listBets } from '@/app/api/admin/bets/route'
import { POST as batchReview } from '@/app/api/admin/verifications/batch/route'
import { POST as exportCsv } from '@/app/api/admin/export/route'
import { GET as listVerifications } from '@/app/api/admin/verifications/route'
import { GET as stats } from '@/app/api/admin/stats/route'
import { GET as revenue } from '@/app/api/admin/reports/revenue/route'
import { GET as payoutsReport } from '@/app/api/admin/reports/payouts/route'

let db: FakeDb
const asAdmin = () => {
  db.seed('profiles', { id: USER_A.id, name: 'Seed Admin', is_admin: true })
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
}
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('input validation', () => {
  it('course creation: 400 INVALID_INPUT with field issues for a bad body, no row written', async () => {
    asAdmin()
    const res = await createCourse(jsonRequest('http://x', { name: '', lat: 999, image_url: 'not a url' }) as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_INPUT')
    expect(body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['image_url', 'lat', 'name'])
    expect(db.rows('courses')).toHaveLength(0)
  })

  it('course creation: unknown fields are dropped, defaults applied', async () => {
    asAdmin()
    const res = await createCourse(jsonRequest('http://x', { name: 'Leopard Creek', is_admin: true, id: 'forced-id' }) as never)
    expect(res.status).toBe(200)
    const [course] = db.rows('courses')
    expect(course).toMatchObject({ name: 'Leopard Creek', country: 'South Africa', is_partner: false })
    expect(course.id).not.toBe('forced-id')
    expect(course).not.toHaveProperty('is_admin')
  })

  it('course patch: an empty body is a 400, and only whitelisted fields reach the update', async () => {
    asAdmin()
    const [course] = db.seed('courses', { id: COURSE_ID, name: 'Old', is_partner: false })
    expect((await patchCourse(jsonRequest('http://x', {}, { method: 'PATCH' }) as never, params({ courseId: COURSE_ID }))).status).toBe(400)
    const res = await patchCourse(jsonRequest('http://x', { is_partner: true, created_at: '1999-01-01' }, { method: 'PATCH' }) as never, params({ courseId: COURSE_ID }))
    expect(res.status).toBe(200)
    expect(course.is_partner).toBe(true)
    expect(course.created_at).not.toBe('1999-01-01')
  })

  it('hole creation: rejects hole numbers outside 1–18 and impossible distances', async () => {
    asAdmin()
    for (const body of [{ hole_number: 19 }, { hole_number: 0 }, { hole_number: 4, distance_metres: 5 }, { hole_number: 4, par: 'three' }]) {
      const res = await createHole(jsonRequest('http://x', body) as never, params({ courseId: COURSE_ID }))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(db.rows('holes')).toHaveLength(0)
    const ok = await createHole(jsonRequest('http://x', { hole_number: 4, distance_metres: 165 }) as never, params({ courseId: COURSE_ID }))
    expect(ok.status).toBe(200)
    expect(db.rows('holes')[0]).toMatchObject({ course_id: COURSE_ID, hole_number: 4, par: 3, is_active: true, jackpot_amount: 0 })
  })

  it('user suspension: boolean required, reason capped, cannot suspend yourself', async () => {
    asAdmin()
    const [victim] = db.seed('profiles', { id: USER_B.id, name: 'Mallory' })
    expect((await patchUser(jsonRequest('http://x', { suspended: 'yes' }, { method: 'PATCH' }) as never, params({ userId: USER_B.id }))).status).toBe(400)
    expect((await patchUser(jsonRequest('http://x', { suspended: true, reason: 'x'.repeat(501) }, { method: 'PATCH' }) as never, params({ userId: USER_B.id }))).status).toBe(400)
    const self = await patchUser(jsonRequest('http://x', { suspended: true }, { method: 'PATCH' }) as never, params({ userId: USER_A.id }))
    expect(self.status).toBe(409)

    const res = await patchUser(jsonRequest('http://x', { suspended: true, reason: 'Chargeback' }, { method: 'PATCH' }) as never, params({ userId: USER_B.id }))
    expect(res.status).toBe(200)
    expect(victim.suspended_reason).toBe('Chargeback')
    expect(typeof victim.suspended_at).toBe('string')
  })

  it('list queries: bad page/limit/status values are 400s, good ones apply defaults', async () => {
    asAdmin()
    expect((await listBets(new Request('http://x/api/admin/bets?status=won') as never)).status).toBe(400)
    expect((await listBets(new Request('http://x/api/admin/bets?limit=1000') as never)).status).toBe(400)
    expect((await listUsers(new Request('http://x/api/admin/users?page=-1') as never)).status).toBe(400)
    const ok = await listCourses(new Request('http://x/api/admin/courses') as never)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ page: 1, limit: 20, data: [] })
  })

  it('batch review: ids must be uuids, at most 50, action from the fixed set, and never approve', async () => {
    asAdmin()
    expect((await batchReview(jsonRequest('http://x', { ids: ['v1'], action: 'reject', notes: 'All four checked by phone with the club.' }) as never)).status).toBe(400)
    expect((await batchReview(jsonRequest('http://x', { ids: Array(51).fill(COURSE_ID), action: 'reject', notes: 'All four checked by phone with the club.' }) as never)).status).toBe(400)
    expect((await batchReview(jsonRequest('http://x', { ids: [COURSE_ID], action: 'pay' }) as never)).status).toBe(400)
    const approve = await batchReview(jsonRequest('http://x', { ids: [COURSE_ID], action: 'approve', notes: 'All four checked by phone with the club.' }) as never)
    expect(approve.status).toBe(400)
    expect(await approve.json()).toMatchObject({ code: 'BATCH_APPROVE_NOT_ALLOWED' })
  })

  it('export: type must be one of the four, and filters are checked', async () => {
    asAdmin()
    expect((await exportCsv(jsonRequest('http://x', { type: 'secrets' }) as never)).status).toBe(400)
    expect((await exportCsv(jsonRequest('http://x', { type: 'bets', status: 'won' }) as never)).status).toBe(400)
    expect((await exportCsv(jsonRequest('http://x', { type: 'bets', tier: 'tier_99' }) as never)).status).toBe(400)
    db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek' })
    db.seed('holes', { id: HOLE_ID, hole_number: 4 })
    db.seed('bets', { user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', stake_pence: 5000, potential_win_pence: 2_500_000, status: 'miss', created_at: '2026-09-01T00:00:00Z' })
    const res = await exportCsv(jsonRequest('http://x', { type: 'bets' }) as never)
    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv.split('\n')).toHaveLength(2)
    expect(csv).toContain('"Seed Admin","Leopard Creek","4","tier_1"')
  })
})

describe('CSV export', () => {
  const USER_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const post = (body: unknown) => exportCsv(jsonRequest('http://x', body) as never)
  const lines = async (res: Response) => (await res.text()).split('\n')
  function seedPlaces() {
    asAdmin()
    db.seed('profiles', { id: USER_C, name: 'Mallory Mokoena', email: 'mallory@example.test' })
    db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek' })
    db.seed('holes', { id: HOLE_ID, hole_number: 4 })
  }
  const bet = (over: Record<string, unknown>) => ({ user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', stake_pence: 5000, potential_win_pence: 2_500_000, status: 'miss', created_at: '2026-09-01T00:00:00Z', ...over })

  it('bets take the list\'s filters: status, tier and search', async () => {
    seedPlaces()
    const [mine] = db.seed('bets', bet({ user_id: USER_C }))
    const [paid] = db.seed('bets', bet({ user_id: USER_C, tier: 'tier_2', status: 'paid' }))
    db.seed('bets', bet({}))
    expect(await lines(await post({ type: 'bets' }))).toHaveLength(4)
    expect(await lines(await post({ type: 'bets', status: 'miss' }))).toHaveLength(3)
    const byName = await lines(await post({ type: 'bets', status: 'miss', search: 'mallory' }))
    expect(byName).toHaveLength(2)
    expect(byName[1]).toContain(`"${mine.id}","Mallory Mokoena"`)
    const byTier = await lines(await post({ type: 'bets', tier: 'tier_2' }))
    expect(byTier.slice(1).map(l => l.split(',')[0])).toEqual([`"${paid.id}"`])
    const none = await post({ type: 'bets', search: 'nobody' })
    expect(none.headers.get('X-Export-Rows')).toBe('0')
    expect(await lines(none)).toHaveLength(1)
  })

  it('users take the list\'s filters: search and suspended', async () => {
    seedPlaces()
    db.seed('profiles', { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Sipho Dlamini', email: 'sipho.d@example.test', suspended_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' })
    const all = (await lines(await post({ type: 'users' }))).length - 1
    const bySearch = await lines(await post({ type: 'users', search: 'sipho.d@' }))
    expect(bySearch).toHaveLength(2)
    expect(bySearch[1]).toContain('"Sipho Dlamini"')
    const suspended = await lines(await post({ type: 'users', suspended: 'true' }))
    expect(suspended.slice(1).every(l => l.includes('"Sipho Dlamini"'))).toBe(true)
    expect((await lines(await post({ type: 'users', suspended: 'false' }))).length - 1).toBe(all - 1)
  })

  it('times are South African, and the file is named by the South African date', async () => {
    seedPlaces()
    db.seed('bets', bet({ created_at: '2026-09-24T22:30:00Z' }))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-24T23:30:00Z'))   // 01:30 on the 25th in Johannesburg
    try {
      const res = await post({ type: 'bets' })
      expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="bets-export-2026-09-25.csv"')
      const [head, row] = await lines(res)
      expect(head).toContain('"Created (SAST)"')
      expect(row).toContain('"2026-09-25 00:30:00"')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads past 1,000 rows without repeating one, and says so when it stops at the cap', async () => {
    seedPlaces()
    db.seed('bets', ...Array.from({ length: 1500 }, () => bet({})))
    const some = await post({ type: 'bets' })
    expect(some.headers.get('X-Export-Rows')).toBe('1500')
    expect(some.headers.get('X-Export-Capped')).toBeNull()
    expect(new Set((await lines(some)).slice(1).map(l => l.split(',')[0])).size).toBe(1500)

    db.seed('bets', ...Array.from({ length: 8501 }, () => bet({})))
    const capped = await post({ type: 'bets' })
    expect(capped.headers.get('X-Export-Capped')).toBe('10000')
    expect(new Set((await lines(capped)).slice(1).map(l => l.split(',')[0])).size).toBe(10000)
  })

  it('payments: "Paid, but no bet" as on the page, with both references', async () => {
    seedPlaces()
    db.seed('payfast_payments',
      { m_payment_id: 'gl_orphan', pf_payment_id: '900001', user_id: USER_C, amount_cents: 5000, status: 'complete', bet_id: null, raw_payload: {}, created_at: '2026-09-17T08:00:00Z' },
      { m_payment_id: 'gl_ok', pf_payment_id: '900002', user_id: USER_C, amount_cents: 5000, status: 'complete', bet_id: '55555555-5555-4555-8555-555555555555', raw_payload: {}, created_at: '2026-09-17T09:00:00Z' },
    )
    const all = await lines(await post({ type: 'payments' }))
    expect(all[0]).toContain('"Reference","PayFast Reference","Golfer","Email"')
    expect(all).toHaveLength(3)
    const unmatched = await lines(await post({ type: 'payments', unmatched: true }))
    expect(unmatched).toHaveLength(2)
    expect(unmatched[1]).toContain('"gl_orphan","900001","Mallory Mokoena","mallory@example.test"')
  })

  it('a failed export is a JSON error, never a file', async () => {
    seedPlaces()
    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db, { failTable: { bets: { code: '57014', message: 'timeout' } } }))
    const res = await post({ type: 'bets' })
    expect(res.status).toBe(500)
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })
})

describe('correct lists (Batch 6)', () => {
  const USER_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  function seedPeople() {
    asAdmin()
    db.seed('profiles',
      { id: USER_B.id, name: 'Mallory Mokoena', email: 'mallory@example.test', created_at: '2026-09-02T00:00:00Z' },
      { id: USER_C, name: 'Thabo Reyneke', email: 'thabo@example.test', created_at: '2026-09-03T00:00:00Z' },
    )
    db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek' })
    db.seed('holes', { id: HOLE_ID, hole_number: 4 })
  }

  it('user search matches name or email in the query, with exact totals and the email shown', async () => {
    seedPeople()
    const byEmail = await (await listUsers(new Request('http://x/api/admin/users?search=thabo@') as never)).json()
    expect(byEmail.total).toBe(1)
    expect(byEmail.data[0]).toMatchObject({ id: USER_C, email: 'thabo@example.test' })
    const byName = await (await listUsers(new Request('http://x/api/admin/users?search=mokoena') as never)).json()
    expect(byName.data.map((u: { id: string }) => u.id)).toEqual([USER_B.id])
    const none = await (await listUsers(new Request('http://x/api/admin/users?search=nobody') as never)).json()
    expect(none).toMatchObject({ total: 0, data: [] })
  })

  it('bet search resolves player names, emails, course names and bet ids into the query', async () => {
    seedPeople()
    const [b1] = db.seed('bets', { user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'miss', stake_pence: 5000, potential_win_pence: 2_500_000 })
    db.seed('bets', { user_id: USER_C, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_2', status: 'active', stake_pence: 10000, potential_win_pence: 6_000_000 })
    const byName = await (await listBets(new Request('http://x/api/admin/bets?search=mallory') as never)).json()
    expect(byName.total).toBe(1)
    expect(byName.data[0].userName).toBe('Mallory Mokoena')
    const byCourse = await (await listBets(new Request('http://x/api/admin/bets?search=leopard') as never)).json()
    expect(byCourse.total).toBe(2)
    const byId = await (await listBets(new Request(`http://x/api/admin/bets?search=${b1.id}`) as never)).json()
    expect(byId.data.map((b: { id: string }) => b.id)).toEqual([b1.id])
    const none = await (await listBets(new Request('http://x/api/admin/bets?search=zzz') as never)).json()
    expect(none).toMatchObject({ total: 0, totalPages: 0 })
    // PostgREST delimiters in the term cannot break the filter
    const weird = await listBets(new Request('http://x/api/admin/bets?search=a),b.eq.(x') as never)
    expect(weird.status).toBe(200)
  })

  it('every tier in the table is a usable filter on both lists, so the admin dropdowns can be built from it', async () => {
    seedPeople()
    for (const t of ALL_TIERS) {
      const bets = await listBets(new Request(`http://x/api/admin/bets?tier=${t.tier}`) as never)
      expect(bets.status, `bets ?tier=${t.tier}`).toBe(200)
      const queue = await listVerifications(new Request(`http://x/api/admin/verifications?tier=${t.tier}`) as never)
      expect(queue.status, `verifications ?tier=${t.tier}`).toBe(200)
    }
    // …and only those: an invented tier is still a 400.
    expect((await listBets(new Request('http://x/api/admin/bets?tier=tier_99') as never)).status).toBe(400)
  })

  it('verification queue: tier filter and highest-value sort give exact totals across pages', async () => {
    seedPeople()
    const mk = (tier: string, win: number, i: number) => {
      const [bet] = db.seed('bets', { user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier, status: 'claimed', stake_pence: 5000, potential_win_pence: win, created_at: `2026-09-0${i}T00:00:00Z` })
      db.seed('verifications', { bet_id: bet.id, status: 'documents_received', created_at: `2026-09-0${i}T01:00:00Z` })
      return bet
    }
    mk('tier_1', 2_500_000, 1); mk('tier_5', 100_000_000, 2); mk('tier_1', 2_500_000, 3); mk('tier_3', 20_000_000, 4)
    const tier1 = await (await listVerifications(new Request('http://x/api/admin/verifications?tier=tier_1&limit=1') as never)).json()
    expect(tier1).toMatchObject({ total: 2, totalPages: 2 })
    expect(tier1.data).toHaveLength(1)
    const highest = await (await listVerifications(new Request('http://x/api/admin/verifications?sort=highest&limit=2') as never)).json()
    expect(highest.total).toBe(4)
    expect(highest.data.map((v: { potentialWinCents: number }) => v.potentialWinCents)).toEqual([100_000_000, 20_000_000])
    const page2 = await (await listVerifications(new Request('http://x/api/admin/verifications?sort=highest&limit=2&page=2') as never)).json()
    expect(page2.data.map((v: { potentialWinCents: number }) => v.potentialWinCents)).toEqual([2_500_000, 2_500_000])
  })

  it('verification queue stages: open claims only, and approved claims whose prize is not yet paid', async () => {
    seedPeople()
    const mk = (vStatus: string, betStatus: string, i: number) => {
      const [bet] = db.seed('bets', { user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: betStatus, stake_pence: 5000, potential_win_pence: 2_500_000, created_at: `2026-09-0${i}T00:00:00Z` })
      return db.seed('verifications', { bet_id: bet.id, status: vStatus, created_at: `2026-09-0${i}T01:00:00Z` })[0]
    }
    const pending = mk('pending', 'claimed', 1)
    const docs = mk('documents_received', 'claimed', 2)
    const review = mk('under_review', 'claimed', 3)
    const toPay = mk('approved', 'verified', 4)
    mk('approved', 'paid', 5)
    mk('rejected', 'claimed', 6)
    const ids = async (qs: string) => {
      const res = await listVerifications(new Request(`http://x/api/admin/verifications?${qs}`) as never)
      expect(res.status, qs).toBe(200)
      const body = await res.json()
      return { total: body.total, ids: body.data.map((v: { id: string }) => v.id) }
    }
    expect(await ids('stage=open')).toEqual({ total: 3, ids: [pending.id, docs.id, review.id] })
    expect(await ids('stage=open&sort=newest')).toEqual({ total: 3, ids: [review.id, docs.id, pending.id] })
    expect(await ids('stage=open&sort=highest')).toMatchObject({ total: 3 })
    expect(await ids('stage=awaiting_payout')).toEqual({ total: 1, ids: [toPay.id] })
    expect(await ids('status=approved')).toMatchObject({ total: 2 })
    expect(await ids('')).toMatchObject({ total: 6 })
    expect((await listVerifications(new Request('http://x/api/admin/verifications?stage=paid') as never)).status).toBe(400)
  })

  it('dashboard and revenue report read SQL aggregates', async () => {
    seedPeople()
    db.seed('bets',
      { user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'paid', stake_pence: 5000, potential_win_pence: 2_500_000 },
      { user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'active', stake_pence: 5000, potential_win_pence: 2_500_000 },
      { user_id: USER_C, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_2', status: 'miss', stake_pence: 10000, potential_win_pence: 6_000_000 },
    )
    const s = await (await stats()).json()
    expect(s).toMatchObject({ totalRevenue: 20000, totalPayouts: 2_500_000, totalBets: 3, activeBets: 1, totalUsers: 3, pendingClaims: 0 })
    const r = await (await revenue()).json()
    expect(r).toMatchObject({ totalRevenue: 20000, totalPayouts: 2_500_000, netProfit: -2_480_000, totalBets: 3 })
    expect(r.byTier.find((t: { tier: string }) => t.tier === 'tier_1')).toMatchObject({ count: 2, revenue: 10000, payouts: 2_500_000 })
    expect(r.byCourse[0]).toMatchObject({ name: 'Leopard Creek', count: 3, revenue: 20000 })
  })
})

describe('dashboard totals from migration 032', () => {
  /** The admin client, with admin_totals() answering as the database does. */
  function totalsAre(totals: Record<string, number>) {
    adminClient.createAdminClient.mockImplementation(() => {
      const client = createFakeClient(db)
      const rpc = client.rpc.bind(client)
      client.rpc = async (fn: string, args: unknown) => (fn === 'admin_totals' ? { data: totals, error: null } : rpc(fn, args))
      return client
    })
  }
  const OLD_KEYS = { total_revenue_cents: 15000, total_payout_cents: 0, total_bets: 4, active_bets: 3, pending_claims: 2, total_users: 5 }

  it('before 032 the new figures are null, not a zero that is not true', async () => {
    asAdmin(); totalsAre(OLD_KEYS)
    const s = await (await stats()).json()
    expect(s).toMatchObject({ totalBets: 4, activeBets: 3, pendingClaims: 2, expiredBets: null, claimsToReview: null, claimsWaiting: null, prizesOwed: null })
    expect((await (await revenue()).json()).prizesOwed).toBeNull()
  })

  it('after 032: claims split into the admin\'s and the golfer\'s, expired bets apart, prizes owed', async () => {
    asAdmin()
    totalsAre({ ...OLD_KEYS, active_bets: 1, expired_bets: 2, claims_to_review: 1, claims_waiting: 1, prizes_owed_cents: 2_500_000 })
    const s = await (await stats()).json()
    expect(s).toMatchObject({ activeBets: 1, expiredBets: 2, claimsToReview: 1, claimsWaiting: 1, prizesOwed: 2_500_000, pendingClaims: 2 })
    expect(await (await revenue()).json()).toMatchObject({ prizesOwed: 2_500_000, netProfit: 15000 })
  })
})

describe('payouts report', () => {
  const BET = (n: number) => `b0000000-0000-4000-8000-00000000000${n}`
  const report = async (query = '') => (await payoutsReport(new Request(`http://x/api/admin/reports/payouts${query}`) as never)).json()

  function seedPrizes() {
    asAdmin()
    db.seed('profiles', { id: USER_B.id, name: 'Mallory' })
    db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek' })
    db.seed('holes', { id: HOLE_ID, hole_number: 4 })
    const bet = (n: number, status: string, updated_at: string, extra: Record<string, unknown> = {}) => ({
      id: BET(n), user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', stake_pence: 5000,
      potential_win_pence: 2_500_000, status, created_at: '2026-08-01T00:00:00Z', updated_at, ...extra,
    })
    db.seed('bets',
      bet(1, 'verified', '2026-09-10T00:00:00Z'),
      bet(2, 'verified', '2026-09-02T00:00:00Z'),
      bet(3, 'paid', '2026-09-05T00:00:00Z', { payout_reference: 'FNB 1234' }),
      bet(4, 'paid', '2026-09-20T00:00:00Z', { payout_reference: 'PF-998' }),
      bet(5, 'miss', '2026-09-21T00:00:00Z'),
    )
    db.seed('verifications',
      { bet_id: BET(1), status: 'approved', verified_at: '2026-09-10T00:00:00Z' },
      { bet_id: BET(3), status: 'approved', verified_at: '2026-09-01T00:00:00Z', payout_initiated_at: '2026-09-05T08:00:00Z' },
    )
  }

  it('owed: verified and not paid, the longest-waiting first, with when it was verified', async () => {
    seedPrizes()
    const owed = await report('?kind=owed')
    expect(owed).toMatchObject({ kind: 'owed', total: 2, page: 1, totalPages: 1 })
    expect(owed.data.map((p: { id: string }) => p.id)).toEqual([BET(2), BET(1)])
    expect(owed.data[1]).toMatchObject({ userName: 'Mallory', courseName: 'Leopard Creek', verifiedAt: '2026-09-10T00:00:00Z', paidAt: null })
    // Owed is the default: the list the admin acts on.
    expect((await report()).kind).toBe('owed')
  })

  it('paid: the latest payout first, with its date and its bank or PayFast reference', async () => {
    seedPrizes()
    const paid = await report('?kind=paid')
    expect(paid.total).toBe(2)
    expect(paid.data.map((p: { id: string; payoutReference: string }) => [p.id, p.payoutReference])).toEqual([[BET(4), 'PF-998'], [BET(3), 'FNB 1234']])
    // The claim's payout time where it was recorded, else the bet's last change.
    expect(paid.data.map((p: { paidAt: string }) => p.paidAt)).toEqual(['2026-09-20T00:00:00Z', '2026-09-05T08:00:00Z'])
    expect((await payoutsReport(new Request('http://x/api/admin/reports/payouts?kind=all') as never)).status).toBe(400)
  })
})

describe('failures', () => {
  it('a database failure is a generic 500 with a request id, never the database message', async () => {
    asAdmin()
    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db, { failTable: { courses: { code: '42P01', message: 'relation "courses" does not exist' } } }))
    // requireAdmin reads profiles (fine); the course insert fails.
    const res = await createCourse(jsonRequest('http://x', { name: 'X' }) as never)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('INTERNAL')
    expect(JSON.stringify(body)).not.toContain('relation')
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('non-admins and anonymous callers never reach the handler body', async () => {
    db.seed('profiles', { id: USER_B.id, is_admin: false })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_B }))
    expect((await createCourse(jsonRequest('http://x', { name: 'X' }) as never)).status).toBe(403)
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: null }))
    expect((await createCourse(jsonRequest('http://x', { name: 'X' }) as never)).status).toBe(401)
    expect(db.rows('courses')).toHaveLength(0)
  })
})

describe('users: totals over every bet, and a golfer\'s page', () => {
  const USER_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const userDetail = async (id: string, qs = '') => {
    const { GET } = await import('@/app/api/admin/users/[userId]/route')
    return GET(new Request(`http://x/api/admin/users/${id}${qs}`), params({ userId: id }))
  }
  function seedGolfers() {
    asAdmin()
    db.seed('profiles',
      { id: USER_B.id, name: 'Mallory Mokoena', email: 'mallory@example.test', created_at: '2026-09-02T00:00:00Z' },
      { id: USER_C, name: 'Thabo Reyneke', email: 'thabo@example.test', created_at: '2026-09-03T00:00:00Z' },
    )
    db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek' })
    db.seed('holes', { id: HOLE_ID, hole_number: 4 })
  }

  it('the list and the golfer\'s page agree, past the 1,000-row cap and the latest 50', async () => {
    seedGolfers()
    const bet = (status: string, i: number) => ({ user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status, stake_pence: 5000, potential_win_pence: 2_500_000, created_at: `2026-09-10T00:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` })
    db.seed('bets', ...Array.from({ length: 1100 }, (_, i) => bet(i < 2 ? 'verified' : 'miss', i)))
    db.seed('bets', { user_id: USER_C, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'miss', stake_pence: 10000, potential_win_pence: 2_500_000 })

    const listed = await (await listUsers(new Request('http://x/api/admin/users') as never)).json()
    const mallory = listed.data.find((u: { id: string }) => u.id === USER_B.id)
    expect(mallory).toMatchObject({ totalStaked: 1100 * 5000, totalWon: 2 * 2_500_000 })
    expect(listed.data.find((u: { id: string }) => u.id === USER_C)).toMatchObject({ totalStaked: 10000, totalWon: 0 })

    const res = await userDetail(USER_B.id)
    expect(res.status).toBe(200)
    const page1 = await res.json()
    expect(page1.user).toMatchObject({ totalStaked: mallory.totalStaked, totalWon: mallory.totalWon })
    expect(page1).toMatchObject({ betsPage: 1, betsPerPage: 50 })
    expect(page1.bets).toHaveLength(50)
    const page2 = await (await userDetail(USER_B.id, '?betsPage=2')).json()
    expect(page2.bets).toHaveLength(50)
    expect(page2.bets[0].id).not.toBe(page1.bets[0].id)
    expect((await userDetail(USER_B.id, '?betsPage=0')).status).toBe(400)
  })

  it('shows each bet\'s claim and names the payments from the profile already read', async () => {
    seedGolfers()
    const [claimed] = db.seed('bets', { user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'claimed', stake_pence: 5000, potential_win_pence: 2_500_000 })
    db.seed('bets', { user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'miss', stake_pence: 5000, potential_win_pence: 2_500_000 })
    const [claim] = db.seed('verifications', { bet_id: claimed.id, status: 'documents_received' })
    db.seed('payfast_payments', { m_payment_id: 'GL-1', user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', amount_cents: 5000, status: 'complete', bet_id: claimed.id, raw_payload: {} })

    const json = await (await userDetail(USER_B.id)).json()
    expect(json.bets.find((b: { id: string }) => b.id === claimed.id)).toMatchObject({ courseName: 'Leopard Creek', holeNumber: 4, userName: 'Mallory Mokoena', claim: { id: claim.id, status: 'documents_received' } })
    expect(json.bets.find((b: { id: string }) => b.id !== claimed.id).claim).toBeNull()
    expect(json.payments[0]).toMatchObject({ userName: 'Mallory Mokoena', userEmail: 'mallory@example.test', courseName: 'Leopard Creek', holeNumber: 4, betId: claimed.id })
  })

  it('404 only for a golfer who is not there; a failed read is a 500', async () => {
    seedGolfers()
    expect((await userDetail('dddddddd-dddd-4ddd-8ddd-dddddddddddd')).status).toBe(404)
    expect((await userDetail('not-a-uuid')).status).toBe(404)
    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db, { failTable: { bets: { code: '57014', message: 'timeout' } } }))
    expect((await userDetail(USER_B.id)).status).toBe(500)
    expect((await listUsers(new Request('http://x/api/admin/users') as never)).status).toBe(500)
  })

  it('finds a golfer by their whole email address', async () => {
    seedGolfers()
    const found = await (await listUsers(new Request('http://x/api/admin/users?search=thabo@example.test') as never)).json()
    expect(found.data.map((u: { id: string }) => u.id)).toEqual([USER_C])
  })
})
