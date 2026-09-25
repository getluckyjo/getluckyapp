/**
 * GET /api/golf-days
 * Returns: { tab: { slug, tabLabel } | null }
 *
 * Which golf day, if any, takes the Icons tab's place for this player. Only
 * a golf day they joined through its link, not switched off, from joining
 * until a week after the day (claims are still in hand then). Everyone else,
 * signed out included, keeps Icons.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api/http'
import { tabVisible } from '@/lib/golf-days/rules'

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

    const { data: days, error: daysError } = await admin
      .from('golf_days').select('slug, tab_label, plays_on, disabled_at').in('id', ids)
    if (daysError) throw daysError

    // The soonest one still showing: a golf day next week before one last month.
    const showing = ((days ?? []) as { slug: string; tab_label: string; plays_on: string; disabled_at: string | null }[])
      .filter(d => !d.disabled_at && tabVisible(d.plays_on))
      .sort((a, b) => a.plays_on.localeCompare(b.plays_on))
    const day = showing[0]
    return NextResponse.json({ tab: day ? { slug: day.slug, tabLabel: day.tab_label } : null })
  } catch (err) {
    return apiError('golf_days.tab_failed', err)
  }
}
