/**
 * GET /api/admin/golf-days/[golfDayId]/players
 * Returns: { data: [{ userId, name, email, joinedAt, swing }] }
 *
 * Who joined a golf day and where each player's swing stands, for the day
 * itself: who has not taken theirs yet, and which ones came in.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, uuid } from '@/lib/api/http'
import { holesFor } from '@/lib/golf-days/load'

type Ctx = { params: Promise<{ golfDayId: string }> }

/** Profiles are read this many ids at a time. */
const PROFILE_CHUNK = 200

export async function GET(_request: Request, { params }: Ctx) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { golfDayId } = await params
  if (!uuid.safeParse(golfDayId).success) return NextResponse.json({ error: 'Invalid id', code: 'INVALID_INPUT' }, { status: 400 })

  try {
    const admin = auth.adminClient
    const [{ data: players, error }, { data: swings, error: swingsError }, holes] = await Promise.all([
      admin.from('golf_day_players').select('user_id, joined_at').eq('golf_day_id', golfDayId).order('joined_at', { ascending: true }).range(0, 4999),
      admin.from('bets').select('id, user_id, status, hole_id, created_at').eq('golf_day_id', golfDayId).range(0, 4999),
      holesFor(admin, [golfDayId]),
    ])
    if (error) throw error
    if (swingsError) throw swingsError

    // In chunks: every id goes in the query string, and 5 000 of them are far
    // past what a URL can carry.
    type Profile = { id: string; name: string | null; email: string | null }
    const userIds = (players ?? []).map((p: { user_id: string }) => p.user_id)
    const chunks: string[][] = []
    for (let i = 0; i < userIds.length; i += PROFILE_CHUNK) chunks.push(userIds.slice(i, i + PROFILE_CHUNK))
    const profiles: Profile[] = []
    for (const res of await Promise.all(chunks.map(ids => admin.from('profiles').select('id, name, email').in('id', ids)))) {
      if (res.error) throw res.error
      profiles.push(...((res.data ?? []) as Profile[]))
    }

    const profileById = new Map(profiles.map(p => [p.id, p]))
    type Swing = { id: string; user_id: string; status: string; hole_id: string; created_at: string }
    const swingByUser = new Map(((swings ?? []) as Swing[]).map(s => [s.user_id, s]))
    const holeById = new Map((holes.get(golfDayId) ?? []).map(h => [h.holeId, h]))

    const data = ((players ?? []) as { user_id: string; joined_at: string }[]).map(p => {
      const profile = profileById.get(p.user_id)
      const swing = swingByUser.get(p.user_id)
      const hole = swing ? holeById.get(swing.hole_id) : undefined
      return {
        userId: p.user_id,
        name: profile?.name ?? null,
        email: profile?.email ?? null,
        joinedAt: p.joined_at,
        swing: swing ? {
          betId: swing.id,
          status: swing.status,
          at: swing.created_at,
          hole: hole ? `${hole.course.name}, hole ${hole.holeNumber}` : null,
        } : null,
      }
    })
    return NextResponse.json({ data })
  } catch (err) {
    return apiError('admin.golf_days.players_failed', err, { path: 'admin_review' })
  }
}
