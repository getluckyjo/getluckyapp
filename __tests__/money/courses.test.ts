/**
 * GET /api/courses lists every course, partner courses first, so the Top 100
 * show again while only partners are playable (checkout enforces that).
 * Each hole is flagged `playable` (par 3, 140 m or more) and the playable
 * ones come first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient } from '../helpers/fake-supabase'
import { GET } from '@/app/api/courses/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)

let db: FakeDb
beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockResolvedValue(createFakeClient(db))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

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
