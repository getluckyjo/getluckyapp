import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/api/http'
import { isHolePlayable } from '@/lib/holes'

// Cache courses for 5 min on the phone and at Vercel's edge, serve stale
// for 24h while revalidating: the list changes when an admin edits a course,
// and the phone on the course gets the edge's copy from the nearest point.
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
}

/** What the list screen reads; the rest of the row (coordinates, notes, audit columns) stays home. */
const COURSE_COLUMNS = 'id, name, location_text, region, country, lat, lng, image_url, is_partner'

/**
 * GET /api/courses — every listed course with its active par-3 holes,
 * playable ones first. Migration 019 lists the Top 100 and opens them all
 * to play; a course an admin closes (is_partner off) is still listed, as
 * "coming soon", and checkout refuses it.
 *
 * Each hole carries `playable`: par 3 and at least MIN_HOLE_METRES long
 * (src/lib/holes.ts). Shorter holes are returned too, after the playable
 * ones, so the screen can show them greyed with the reason; checkout
 * refuses them regardless of what the client sends.
 *
 * The 1,180-line seed file that used to serve as a fallback is gone: its ids
 * were not UUIDs and never survived checkout, and its images were hot-linked
 * from a third-party site. If the database is unreachable the client gets a
 * 500 and shows its retry state, which is the truth.
 */
interface HoleRow {
  id: string
  hole_number: number
  par: number
  distance_metres: number | null
}
type CourseWithHoles = Record<string, unknown> & { holes: HoleRow[] | null }

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: courses, error } = await supabase
      .from('courses')
      .select(`${COURSE_COLUMNS}, holes(id, hole_number, par, distance_metres)`)
      .eq('holes.is_active', true)
      .order('is_partner', { ascending: false })
      .order('name')
    if (error) throw error
    const withPlayable = ((courses ?? []) as unknown as CourseWithHoles[]).map(c => ({
      ...c,
      holes: [...(c.holes ?? [])]
        .map(h => ({ ...h, playable: isHolePlayable(h) }))
        .sort((a, b) => Number(b.playable) - Number(a.playable) || a.hole_number - b.hole_number),
    }))
    return NextResponse.json({ courses: withPlayable, source: 'database' }, { headers: CACHE_HEADERS })
  } catch (err) {
    return apiError('courses.list_failed', err, { message: 'Could not load courses. Please try again.' })
  }
}
