/**
 * Reading a golf day, for the routes. The golf day tables are closed to the
 * public API (migration 029), so these take the service-role client; what
 * a player may see of them is decided by the route that calls.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { MIN_HOLE_METRES, isHolePlayable } from '@/lib/holes'
import type { GolfDayHole } from './rules'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

export interface GolfDayRow {
  id: string
  slug: string
  name: string
  tab_label: string
  plays_on: string
  prize_pence: number
  max_players: number
  note: string | null
  disabled_at: string | null
  created_at: string
  /** The look set in the admin (migration 031); read with parseLook. Absent before 031 has run. */
  look?: unknown
}

/**
 * Every column, rather than a list: `look` arrives with migration 031, and
 * naming it would break every golf day screen on a database 031 has not
 * reached yet. Callers map the row to what they show.
 */
export const GOLF_DAY_SELECT = '*'

export async function golfDayBySlug(admin: Client, slug: string): Promise<GolfDayRow | null> {
  const { data, error } = await admin.from('golf_days').select(GOLF_DAY_SELECT).eq('slug', slug).maybeSingle()
  if (error) throw error
  return (data as GolfDayRow | null) ?? null
}

/** The holes of each golf day asked for, with their courses, by golf day id. */
export async function holesFor(admin: Client, golfDayIds: string[]): Promise<Map<string, GolfDayHole[]>> {
  const out = new Map<string, GolfDayHole[]>(golfDayIds.map(id => [id, []]))
  if (!golfDayIds.length) return out

  const { data: links, error } = await admin.from('golf_day_holes').select('golf_day_id, hole_id').in('golf_day_id', golfDayIds)
  if (error) throw error
  const holeIds = [...new Set((links ?? []).map((l: { hole_id: string }) => l.hole_id))]
  if (!holeIds.length) return out

  const { data: holes, error: holesError } = await admin
    .from('holes').select('id, course_id, hole_number, par, distance_metres').in('id', holeIds)
  if (holesError) throw holesError
  const courseIds = [...new Set((holes ?? []).map((h: { course_id: string }) => h.course_id))]
  const { data: courses, error: coursesError } = await admin
    .from('courses').select('id, name, location_text, region').in('id', courseIds)
  if (coursesError) throw coursesError

  type HoleRow = { id: string; course_id: string; hole_number: number; par: number; distance_metres: number | null }
  type CourseRow = { id: string; name: string; location_text: string | null; region: string | null }
  const holeById = new Map((holes ?? []).map((h: HoleRow) => [h.id, h]))
  const courseById = new Map((courses ?? []).map((c: CourseRow) => [c.id, c]))

  for (const link of (links ?? []) as { golf_day_id: string; hole_id: string }[]) {
    const hole = holeById.get(link.hole_id)
    const course = hole && courseById.get(hole.course_id)
    if (!hole || !course) continue
    out.get(link.golf_day_id)?.push({
      holeId: hole.id,
      holeNumber: hole.hole_number,
      par: hole.par,
      distanceMetres: hole.distance_metres,
      course: { id: course.id, name: course.name, location: course.location_text ?? course.region ?? '', region: course.region ?? '' },
    })
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.course.name.localeCompare(b.course.name) || a.holeNumber - b.holeNumber)
  }
  return out
}

/** How many players have joined a golf day (exact, not capped at a page). */
export async function playerCount(admin: Client, golfDayId: string): Promise<number> {
  const { count, error } = await admin
    .from('golf_day_players').select('user_id', { count: 'exact', head: true }).eq('golf_day_id', golfDayId)
  if (error) throw error
  return count ?? 0
}

/**
 * Why these holes cannot carry a golf day swing, or null when they all can:
 * each must exist, be active, be a playable par 3 (src/lib/holes.ts) and be
 * at a partner course. The swing route checks the same on the day; this
 * says so when the golf day is set up, not in front of a player.
 */
export async function holesProblem(admin: Client, holeIds: string[]): Promise<string | null> {
  const { data: holes, error } = await admin
    .from('holes').select('id, course_id, hole_number, par, distance_metres, is_active').in('id', holeIds)
  if (error) throw error
  type Row = { id: string; course_id: string; hole_number: number; par: number; distance_metres: number | null; is_active: boolean }
  const found = (holes ?? []) as Row[]
  if (found.length !== new Set(holeIds).size) return 'One of those holes does not exist.'

  const { data: courses, error: coursesError } = await admin
    .from('courses').select('id, name, is_partner').in('id', [...new Set(found.map(h => h.course_id))])
  if (coursesError) throw coursesError
  const courseById = new Map(((courses ?? []) as { id: string; name: string; is_partner: boolean }[]).map(c => [c.id, c]))

  for (const hole of found) {
    const course = courseById.get(hole.course_id)
    const where = `${course?.name ?? 'That course'}, hole ${hole.hole_number}`
    if (!course?.is_partner) return `${course?.name ?? 'That course'} is not open for the challenge (Admin → Courses, Partner).`
    if (!hole.is_active) return `${where} is switched off (Admin → Courses).`
    if (!isHolePlayable(hole)) return `${where} is not a par 3 of ${MIN_HOLE_METRES} m or more.`
  }
  return null
}
