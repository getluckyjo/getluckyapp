/**
 * The one check every paid entry passes, whichever way it is paid: the
 * hole is real, active, long enough (src/lib/holes.ts) and belongs to the
 * course, and the course is open for the challenge.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MIN_HOLE_METRES, holeUnavailableReason, isHolePlayable } from '@/lib/holes'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

/** Null when the target is fine; otherwise the 400 to send back. */
export async function checkTarget(supabase: Client, courseId: string, holeId: string): Promise<NextResponse | null> {
  const { data: hole } = await supabase
    .from('holes')
    .select('id, course_id, is_active, par, distance_metres')
    .eq('id', holeId)
    .maybeSingle()
  if (!hole || hole.course_id !== courseId) {
    return NextResponse.json({ error: 'That hole is not available', code: 'HOLE_INVALID' }, { status: 400 })
  }
  if (!hole.is_active) {
    return NextResponse.json({ error: 'That hole is not currently open for the challenge', code: 'HOLE_INACTIVE' }, { status: 400 })
  }
  if (!isHolePlayable(hole)) {
    return NextResponse.json(
      { error: `The challenge is played on par 3s of ${MIN_HOLE_METRES}m or more (${holeUnavailableReason(hole)})`, code: 'HOLE_NOT_ELIGIBLE' },
      { status: 400 },
    )
  }
  const { data: course } = await supabase.from('courses').select('id, is_partner').eq('id', courseId).maybeSingle()
  if (!course?.is_partner) {
    return NextResponse.json({ error: 'That course is not a partner course', code: 'COURSE_NOT_PARTNER' }, { status: 400 })
  }
  return null
}
