import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api/http'
import { ICONS_EVENT, shouldRevealVotes, sortIcons, withStandings, type IconTeam, type PublicIcon } from '@/lib/icons'

/**
 * GET /api/icons — the field, with how many golfers back each Icon, and the
 * caller's own pick when signed in. Public: signed-out golfers see the
 * standings and are asked to sign in to pick.
 *
 * `revealVotes` says whether the counts are worth showing yet
 * (VOTE_REVEAL_THRESHOLD). The numbers ride along either way, so the moment
 * the field crosses it every client already has the right standings.
 *
 * Totals are counted with the service role because golfers can only read
 * their own vote row. At this scale (one row per golfer) counting in the
 * handler is fine; a SQL aggregate is the next move if it ever is not.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const admin = createAdminClient()

    const [{ data: icons, error: iconsErr }, { data: votes, error: votesErr }] = await Promise.all([
      admin.from('icons').select('id, name, team, is_captain, tagline, photo_url, sort_order').eq('is_active', true),
      admin.from('icon_votes').select('icon_id'),
    ])
    if (iconsErr) throw iconsErr
    if (votesErr) throw votesErr

    const counts = new Map<string, number>()
    for (const v of votes ?? []) counts.set(v.icon_id, (counts.get(v.icon_id) ?? 0) + 1)

    const ordered = sortIcons((icons ?? []).map(i => ({
      id: i.id,
      name: i.name,
      team: (i.team ?? 'rsa') as IconTeam,
      isCaptain: !!i.is_captain,
      sortOrder: i.sort_order ?? 100,
      tagline: i.tagline ?? null,
      photoUrl: i.photo_url ?? null,
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
    })
  } catch (err) {
    return apiError('icons.list_failed', err, { message: 'Could not load the Icons. Please try again.' })
  }
}
