/**
 * Admin routes after Batch 5: every input goes through a schema, every
 * failure through apiError, no mock branches, no leaked error messages.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'

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

  it('batch review: ids must be uuids, at most 50, action from the fixed set', async () => {
    asAdmin()
    expect((await batchReview(jsonRequest('http://x', { ids: ['v1'], action: 'approve' }) as never)).status).toBe(400)
    expect((await batchReview(jsonRequest('http://x', { ids: Array(51).fill(COURSE_ID), action: 'approve' }) as never)).status).toBe(400)
    expect((await batchReview(jsonRequest('http://x', { ids: [COURSE_ID], action: 'pay' }) as never)).status).toBe(400)
  })

  it('export: type must be one of the three', async () => {
    asAdmin()
    expect((await exportCsv(jsonRequest('http://x', { type: 'secrets' }) as never)).status).toBe(400)
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

  it('dashboard and revenue report read SQL aggregates', async () => {
    seedPeople()
    db.seed('bets',
      { user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'paid', stake_pence: 5000, potential_win_pence: 2_500_000 },
      { user_id: USER_B.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'active', stake_pence: 5000, potential_win_pence: 2_500_000 },
      { user_id: USER_C, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_2', status: 'miss', stake_pence: 10000, potential_win_pence: 6_000_000 },
    )
    const s = await (await stats()).json()
    expect(s).toMatchObject({ totalRevenue: 20000, totalPayouts: 2_500_000, activeBets: 1, totalUsers: 3, pendingClaims: 0 })
    const r = await (await revenue()).json()
    expect(r).toMatchObject({ totalRevenue: 20000, totalPayouts: 2_500_000, netProfit: -2_480_000, totalBets: 3 })
    expect(r.byTier.find((t: { tier: string }) => t.tier === 'tier_1')).toMatchObject({ count: 2, revenue: 10000, payouts: 2_500_000 })
    expect(r.byCourse[0]).toMatchObject({ name: 'Leopard Creek', count: 3, revenue: 20000 })
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
