import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/api/http'

// Cache courses for 5 min, serve stale for 24h while revalidating
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
}

/**
 * GET /api/courses — partner courses with their active par-3 holes.
 *
 * The 1,180-line seed file that used to serve as a fallback is gone: its ids
 * were not UUIDs and never survived checkout, and its images were hot-linked
 * from a third-party site. If the database is unreachable the client gets a
 * 500 and shows its retry state, which is the truth.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: courses, error } = await supabase
      .from('courses')
      .select('*, holes(id, hole_number, par, distance_metres)')
      .eq('is_partner', true)
      .eq('holes.is_active', true)
      .order('name')
    if (error) throw error
    return NextResponse.json({ courses: courses ?? [], source: 'database' }, { headers: CACHE_HEADERS })
  } catch (err) {
    return apiError('courses.list_failed', err, { message: 'Could not load courses. Please try again.' })
  }
}
