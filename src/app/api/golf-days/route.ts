/**
 * GET /api/golf-days
 * Returns: { tab: { slug, tabLabel } | null }
 *
 * Which golf day, if any, takes the Icons tab's place for this player. Only
 * a golf day they joined through its link, not switched off, from joining
 * until the day (a trip's last day) is over. After it, only while one of
 * their swings there is still in hand (started and open, claimed, or
 * verified), for a week at most. Everyone else, signed out included, keeps
 * Icons.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api/http'
import { lastDay, swingInHand, tabShows } from '@/lib/golf-days/rules'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ tab: null })

    const admin = createAdminClient()
    const { data: joined, error } = await admin.from('golf_day_players').select('golf_day_id').eq('user_id', user.id)
    if (error) throw error
    const ids = (joined ?? []).map((j: { golf_day_id: string }) => j.golf_day_id)
    if (!ids.length) return NextResponse.json({ tab: null })

    // Every column: a trip's ends_on arrives with migration 033.
    const [{ data: days, error: daysError }, { data: swings, error: swingsError }] = await Promise.all([
      admin.from('golf_days').select('*').in('id', ids),
      admin.from('bets').select('golf_day_id, status, expires_at').eq('user_id', user.id).in('golf_day_id', ids)
        .in('status', ['active', 'claimed', 'verified']),
    ])
    if (daysError) throw daysError
    if (swingsError) throw swingsError
    const now = Date.now()
    const inHand = new Set(((swings ?? []) as { golf_day_id: string; status: string; expires_at: string | null }[])
      .filter(s => swingInHand(s.status, s.expires_at, now)).map(s => s.golf_day_id))

    // The soonest one still showing: a golf day next week before one last month.
    type Day = { id: string; slug: string; tab_label: string; plays_on: string; ends_on?: string | null; disabled_at: string | null }
    const showing = ((days ?? []) as Day[])
      .filter(d => !d.disabled_at && tabShows(lastDay(d.plays_on, d.ends_on), inHand.has(d.id), now))
      .sort((a, b) => a.plays_on.localeCompare(b.plays_on))
    const day = showing[0]
    return NextResponse.json({ tab: day ? { slug: day.slug, tabLabel: day.tab_label } : null })
  } catch (err) {
    return apiError('golf_days.tab_failed', err)
  }
}
