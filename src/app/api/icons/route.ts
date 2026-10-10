import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api/http'
import { ICONS_EVENT, iconPhoto, shouldRevealVotes, sortIcons, withStandings, type IconTeam, type PublicIcon } from '@/lib/icons'
import { picksOpen } from '@/lib/fan-prize'

/**
 * GET /api/icons — the field, with how many golfers back each Icon, and the
 * caller's own pick when signed in. Public: signed-out golfers see the
 * standings and are asked to sign in to pick.
 *
 * `revealVotes` says whether the counts are worth showing yet
 * (VOTE_REVEAL_THRESHOLD). The numbers ride along either way, so the moment
 * the field crosses it every client already has the right standings.
 *
 * Totals come from the icon_vote_counts view (migration 036) with the
 * service role, because golfers can only read their own vote row. Reading
 * the vote rows themselves stopped at PostgREST's 1,000-row cap, which is
 * where the standings would have frozen during a broadcast.
 *
 * `picksOpen` and `picksCloseAt` tell the screen whether a pick can still
 * be made: picks close at first tee, or earlier once the backer list is
 * frozen for the draw.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const admin = createAdminClient()

    const [{ data: icons, error: iconsErr }, { data: votes, error: votesErr }, { data: event }] = await Promise.all([
      admin.from('icons').select('id, name, team, is_captain, tagline, photo_url, sort_order').eq('is_active', true),
      admin.from('icon_vote_counts').select('icon_id, votes'),
      admin.from('icon_events').select('first_tee_at, frozen_at').order('created_at', { ascending: true }).limit(1).maybeSingle(),
    ])
    if (iconsErr) throw iconsErr
    if (votesErr) throw votesErr

    const counts = new Map<string, number>()
    for (const v of votes ?? []) counts.set(v.icon_id, Number(v.votes ?? 0))

    const ordered = sortIcons((icons ?? []).map(i => ({
      id: i.id,
      name: i.name,
      team: (i.team ?? 'rsa') as IconTeam,
      isCaptain: !!i.is_captain,
      sortOrder: i.sort_order ?? 100,
      tagline: i.tagline ?? null,
      // Admin → Icons wins; the committed headshot is the fallback.
      photoUrl: i.photo_url ?? iconPhoto(i.name),
      votes: counts.get(i.id) ?? 0,
    })))
    const rows: PublicIcon[] = withStandings(ordered).map(r => ({ id: r.id, name: r.name, team: r.team, isCaptain: r.isCaptain, tagline: r.tagline, photoUrl: r.photoUrl, votes: r.votes, share: r.share, isLeader: r.isLeader }))

    let myVote: string | null = null
    if (user) {
      const { data: mine } = await supabase.from('icon_votes').select('icon_id').eq('user_id', user.id).maybeSingle()
      myVote = mine?.icon_id ?? null
    }

    const totalVotes = rows.reduce((s, r) => s + r.votes, 0)
    return NextResponse.json({
      event: ICONS_EVENT,
      icons: rows,
      totalVotes,
      revealVotes: shouldRevealVotes(totalVotes),
      myVote,
      picksOpen: picksOpen(event),
      picksCloseAt: event?.frozen_at ?? event?.first_tee_at ?? null,
    })
  } catch (err) {
    return apiError('icons.list_failed', err, { message: 'Could not load the Icons. Please try again.' })
  }
}
