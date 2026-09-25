/**
 * GET /api/courses lists every course, partner courses first, so the Top 100
 * show again while only partners are playable (checkout enforces that).
 * Each hole is flagged `playable` (par 3, 140 m or more) and the playable
 * ones come first.
 *
 * The admin course routes: search before the page is cut, officials and bets
 * counted per course, the "no club official" filter, coordinates in pairs,
 * and refusals that say why.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A } from '../helpers/fake-supabase'
import { GET } from '@/app/api/courses/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

import { GET as listCourses, POST as createCourse } from '@/app/api/admin/courses/route'
import { GET as courseDetail, PATCH as patchCourse, DELETE as deleteCourse } from '@/app/api/admin/courses/[courseId]/route'

let db: FakeDb
beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockResolvedValue(createFakeClient(db))
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const asAdmin = () => {
  db.seed('profiles', { id: USER_A.id, name: 'Seed Admin', is_admin: true })
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
}
const list = async (qs = '') => (await listCourses(new Request(`http://x/api/admin/courses${qs}`))).json()
const course = (id: string) => ({ params: Promise.resolve({ courseId: id }) })
const C1 = '10000000-0000-4000-8000-000000000001'
const C2 = '10000000-0000-4000-8000-000000000002'
const C3 = '10000000-0000-4000-8000-000000000003'

describe('GET /api/courses', () => {
  it('returns non-partner courses too, partners first, then by name', async () => {
    db.seed('courses',
      { id: 'c-soon-b', name: 'Bellville Golf Club', region: 'Western Cape', is_partner: false },
      { id: 'c-part-z', name: 'Zimbali Country Club', region: 'KwaZulu-Natal', is_partner: true },
      { id: 'c-soon-a', name: 'Arabella Golf Club', region: 'Western Cape', is_partner: false },
      { id: 'c-part-a', name: 'Atlantic Beach Golf Estate', region: 'Western Cape', is_partner: true },
    )
    const res = await GET()
    expect(res.status).toBe(200)
    const { courses } = await res.json()
    expect(courses.map((c: { name: string }) => c.name)).toEqual([
      'Atlantic Beach Golf Estate', 'Zimbali Country Club', 'Arabella Golf Club', 'Bellville Golf Club',
    ])
    expect(courses.map((c: { is_partner: boolean }) => c.is_partner)).toEqual([true, true, false, false])
  })

  it('flags holes shorter than 140m as not playable and lists the playable ones first', async () => {
    db.seed('courses', { id: 'c1', name: 'Arabella Golf Club', is_partner: true })
    db.seed('holes',
      { id: 'h5', course_id: 'c1', hole_number: 5, par: 3, distance_metres: 120, is_active: true },
      { id: 'h8', course_id: 'c1', hole_number: 8, par: 3, distance_metres: 140, is_active: true },
      { id: 'h12', course_id: 'c1', hole_number: 12, par: 3, distance_metres: 175, is_active: true },
      { id: 'h16', course_id: 'c1', hole_number: 16, par: 3, distance_metres: null, is_active: true },
    )
    const { courses } = await (await GET()).json()
    const holes = courses[0].holes as { hole_number: number; playable: boolean }[]
    expect(holes.map(h => [h.hole_number, h.playable])).toEqual([[8, true], [12, true], [5, false], [16, false]])
  })
})

describe('GET /api/admin/courses', () => {
  it('searches name, region and town in the query, so a match past the first page is found and counted', async () => {
    asAdmin()
    // 25 courses sorted by name; the match would be on page 2 if the search ran after the page was cut.
    for (let i = 0; i < 25; i++) db.seed('courses', { name: `A${String(i).padStart(2, '0')} Golf Club`, region: 'Gauteng', location_text: 'Johannesburg', is_partner: false })
    db.seed('courses', { name: 'Zwartkop Country Club', region: 'Gauteng', location_text: 'Centurion', is_partner: true })
    const byTown = await list('?search=centurion')
    expect(byTown.total).toBe(1)
    expect(byTown.data.map((c: { name: string }) => c.name)).toEqual(['Zwartkop Country Club'])
    expect((await list('?search=western')).total).toBe(0)
    // A dot is kept: a search for "St. Francis" is not broken up.
    db.seed('courses', { name: 'St. Francis Links', region: 'Eastern Cape', is_partner: true })
    expect((await list('?search=St. Francis')).data.map((c: { name: string }) => c.name)).toEqual(['St. Francis Links'])
  })

  it('counts each course\'s holes, club officials and bets', async () => {
    asAdmin()
    db.seed('courses', { id: C1, name: 'Arabella', is_partner: true }, { id: C2, name: 'Bellville', is_partner: false })
    db.seed('holes', { course_id: C1, hole_number: 5, is_active: true }, { course_id: C1, hole_number: 8, is_active: false })
    db.seed('course_contacts', { course_id: C1, name: 'Manager', email: 'm@arabella.test' }, { course_id: C1, name: 'Pro', email: 'p@arabella.test' })
    db.seed('bets', { course_id: C1, status: 'miss' }, { course_id: C1, status: 'active' }, { course_id: C2, status: 'miss' })
    const { data } = await list()
    expect(data).toEqual([
      expect.objectContaining({ id: C1, holeCount: 2, activeHoleCount: 1, officialCount: 2, totalBets: 2 }),
      expect.objectContaining({ id: C2, holeCount: 0, activeHoleCount: 0, officialCount: 0, totalBets: 1 }),
    ])
  })

  it('"no club official" lists only partner courses nobody can confirm a claim at', async () => {
    asAdmin()
    db.seed('courses',
      { id: C1, name: 'Arabella', is_partner: true },
      { id: C2, name: 'Bellville', is_partner: false },
      { id: C3, name: 'Clovelly', is_partner: true },
    )
    db.seed('course_contacts', { course_id: C1, name: 'Manager', email: 'm@arabella.test' })
    const none = await list('?officials=none')
    expect(none.data.map((c: { id: string }) => c.id)).toEqual([C3])
    expect(none.data[0].officialCount).toBe(0)
    // Everyone covered: an empty page, not every course.
    db.seed('course_contacts', { course_id: C3, name: 'Pro', email: 'p@clovelly.test' })
    expect(await list('?officials=none')).toMatchObject({ total: 0, data: [] })
    expect((await listCourses(new Request('http://x/api/admin/courses?officials=some'))).status).toBe(400)
  })

  it('a failed count is a 500, never a zero', async () => {
    asAdmin()
    db.seed('courses', { id: C1, name: 'Arabella', is_partner: true })
    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db, { failTable: { course_contacts: { code: '57014', message: 'timeout' } } }))
    expect((await listCourses(new Request('http://x/api/admin/courses'))).status).toBe(500)
  })
})

describe('/api/admin/courses/[courseId]', () => {
  it('reads the course, its holes and its officials; 404 only for a course that is not there', async () => {
    asAdmin()
    db.seed('courses', { id: C1, name: 'Arabella', is_partner: true })
    db.seed('holes', { course_id: C1, hole_number: 8 }, { course_id: C1, hole_number: 5 })
    db.seed('course_contacts', { course_id: C1, name: 'Manager', email: 'm@arabella.test', role: 'club_official' })
    const res = await courseDetail(new Request('http://x'), course(C1))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.course.name).toBe('Arabella')
    expect(json.holes.map((h: { hole_number: number }) => h.hole_number)).toEqual([5, 8])
    expect(json.contacts).toHaveLength(1)
    expect((await courseDetail(new Request('http://x'), course(C2))).status).toBe(404)
    expect((await courseDetail(new Request('http://x'), course('nope'))).status).toBe(404)

    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db, { failTable: { holes: { code: '57014', message: 'timeout' } } }))
    expect((await courseDetail(new Request('http://x'), course(C1))).status).toBe(500)
  })

  it('takes latitude and longitude together or not at all', async () => {
    asAdmin()
    const [row] = db.seed('courses', { id: C1, name: 'Arabella', is_partner: true, lat: null, lng: null })
    const patch = (body: unknown) => patchCourse(jsonRequest('http://x', body, { method: 'PATCH' }), course(C1))
    expect((await patch({ lat: -34.35 })).status).toBe(400)
    expect((await patch({ lat: -34.35, lng: null })).status).toBe(400)
    expect(row.lat).toBeNull()
    expect((await patch({ lat: -34.35, lng: 19.12 })).status).toBe(200)
    expect(row).toMatchObject({ lat: -34.35, lng: 19.12 })
    expect((await patch({ lat: null, lng: null })).status).toBe(200)
    expect((await patch({ is_partner: false })).status).toBe(200)

    const created = await createCourse(jsonRequest('http://x', { name: 'Half Placed', lat: -33.9 }))
    expect(created.status).toBe(400)
    expect((await created.json()).issues[0].path).toBe('lng')
  })

  it('refuses to delete a course with bets and says why; a failed bet count deletes nothing', async () => {
    asAdmin()
    db.seed('courses', { id: C1, name: 'Arabella', is_partner: true })
    db.seed('bets', { course_id: C1, status: 'miss' })
    const res = await deleteCourse(new Request('http://x', { method: 'DELETE' }), course(C1))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('HAS_BETS')
    expect(json.error).toContain('1 bet')
    expect(db.rows('courses')).toHaveLength(1)

    db.rows('bets').length = 0
    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db, { failTable: { bets: { code: '57014', message: 'timeout' } } }))
    expect((await deleteCourse(new Request('http://x', { method: 'DELETE' }), course(C1))).status).toBe(500)
    expect(db.rows('courses')).toHaveLength(1)
  })
})
