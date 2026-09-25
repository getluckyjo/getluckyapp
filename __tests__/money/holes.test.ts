/**
 * The hole rule: the challenge is played on par 3s of 140 m or more.
 * 140 m itself counts (Johannes, 16 September 2026).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MIN_HOLE_METRES, isHolePlayable, holeUnavailableReason } from '@/lib/holes'
import { FakeDb, createFakeClient, jsonRequest, USER_A } from '../helpers/fake-supabase'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

import { POST as addHole } from '@/app/api/admin/courses/[courseId]/holes/route'
import { PATCH as patchHole, DELETE as deleteHole } from '@/app/api/admin/courses/[courseId]/holes/[holeId]/route'

describe('isHolePlayable', () => {
  it('is 140 m', () => expect(MIN_HOLE_METRES).toBe(140))

  it('accepts a par 3 of 140 m or more', () => {
    expect(isHolePlayable({ par: 3, distance_metres: 140 })).toBe(true)
    expect(isHolePlayable({ par: 3, distance_metres: 230 })).toBe(true)
  })

  it('refuses a shorter par 3, any other par, and an unknown distance', () => {
    expect(isHolePlayable({ par: 3, distance_metres: 139 })).toBe(false)
    expect(isHolePlayable({ par: 4, distance_metres: 320 })).toBe(false)
    expect(isHolePlayable({ par: 3, distance_metres: null })).toBe(false)
  })

  it('says why', () => {
    expect(holeUnavailableReason({ par: 3, distance_metres: 140 })).toBeNull()
    expect(holeUnavailableReason({ par: 3, distance_metres: 98 })).toBe('Under 140m')
    expect(holeUnavailableReason({ par: 5, distance_metres: 480 })).toBe('Par 5')
    expect(holeUnavailableReason({ par: 3, distance_metres: null })).toBe('Distance not set')
  })
})

describe('admin hole routes', () => {
  const COURSE = '20000000-0000-4000-8000-000000000001'
  const HOLE = '20000000-0000-4000-8000-000000000002'
  let db: FakeDb
  beforeEach(() => {
    db = new FakeDb()
    db.seed('profiles', { id: USER_A.id, name: 'Seed Admin', is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())
  const hole = (holeId = HOLE) => ({ params: Promise.resolve({ courseId: COURSE, holeId }) })

  it('corrects a hole\'s par and distance, within the limits', async () => {
    const [row] = db.seed('holes', { id: HOLE, course_id: COURSE, hole_number: 7, par: 3, distance_metres: 120, is_active: true })
    const patch = (body: unknown) => patchHole(jsonRequest('http://x', body, { method: 'PATCH' }), hole())
    expect((await patch({ distance_metres: 401 })).status).toBe(400)
    expect((await patch({ par: 6 })).status).toBe(400)
    expect(row.distance_metres).toBe(120)
    expect((await patch({ par: 3, distance_metres: 152 })).status).toBe(200)
    expect(row).toMatchObject({ par: 3, distance_metres: 152 })
    expect(isHolePlayable(row as { par: number; distance_metres: number | null })).toBe(true)
    expect((await patchHole(jsonRequest('http://x', { par: 3 }, { method: 'PATCH' }), hole('20000000-0000-4000-8000-000000000009'))).status).toBe(404)
  })

  it('refuses a duplicate hole number with a reason the page can show', async () => {
    db.seed('holes', { id: HOLE, course_id: COURSE, hole_number: 7, par: 3 })
    // The fake has no unique index on holes: stand in the one the schema has, for this insert.
    const failing = createFakeClient(db)
    const from = failing.from.bind(failing)
    failing.from = ((table: string) => {
      const b = from(table)
      if (table !== 'holes') return b
      return { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) }) } as unknown as ReturnType<typeof from>
    }) as typeof failing.from
    adminClient.createAdminClient.mockImplementation(() => failing)
    const res = await addHole(jsonRequest('http://x', { hole_number: 7, par: 3, distance_metres: 150 }), { params: Promise.resolve({ courseId: COURSE }) })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'DUPLICATE_HOLE', error: expect.stringContaining('Hole 7') })
  })

  it('refuses to delete a hole with bets and says why; deletes one without', async () => {
    db.seed('holes', { id: HOLE, course_id: COURSE, hole_number: 7, par: 3 })
    db.seed('bets', { hole_id: HOLE, status: 'miss' })
    const res = await deleteHole(new Request('http://x', { method: 'DELETE' }), hole())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'HAS_BETS', error: expect.stringContaining('off sale') })
    expect(db.rows('holes')).toHaveLength(1)

    db.rows('bets').length = 0
    expect((await deleteHole(new Request('http://x', { method: 'DELETE' }), hole())).status).toBe(200)
    expect(db.rows('holes')).toHaveLength(0)
    expect((await deleteHole(new Request('http://x', { method: 'DELETE' }), hole())).status).toBe(404)
  })

  it('a failed bet count deletes nothing', async () => {
    db.seed('holes', { id: HOLE, course_id: COURSE, hole_number: 7, par: 3 })
    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db, { failTable: { bets: { code: '57014', message: 'timeout' } } }))
    expect((await deleteHole(new Request('http://x', { method: 'DELETE' }), hole())).status).toBe(500)
    expect(db.rows('holes')).toHaveLength(1)
  })
})
