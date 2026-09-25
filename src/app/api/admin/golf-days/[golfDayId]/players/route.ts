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
/** PostgREST answers at most this many rows per request (Supabase's default max_rows). */
const PAGE = 1000

/** Every row a query would return, a page at a time: a golf day takes up to 5 000 players. */
async function everyRow<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    const got = (data ?? []) as T[]
    rows.push(...got)
    if (got.length < PAGE) return rows
  }
}

export async function GET(_request: Request, { params }: Ctx) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { golfDayId } = await params
  if (!uuid.safeParse(golfDayId).success) return NextResponse.json({ error: 'Invalid id', code: 'INVALID_INPUT' }, { status: 400 })

  try {
    const admin = auth.adminClient
    type Player = { user_id: string; joined_at: string }
    type Swing = { id: string; user_id: string; status: string; hole_id: string; created_at: string }
    const [players, swings, holes] = await Promise.all([
      everyRow<Player>((from, to) => admin.from('golf_day_players').select('user_id, joined_at').eq('golf_day_id', golfDayId)
        .order('joined_at', { ascending: true }).order('user_id', { ascending: true }).range(from, to)),
      everyRow<Swing>((from, to) => admin.from('bets').select('id, user_id, status, hole_id, created_at').eq('golf_day_id', golfDayId)
        .order('id', { ascending: true }).range(from, to)),
      holesFor(admin, [golfDayId]),
    ])

    // In chunks: every id goes in the query string, and 5 000 of them are far
    // past what a URL can carry.
    type Profile = { id: string; name: string | null; email: string | null }
    const userIds = players.map(p => p.user_id)
    const chunks: string[][] = []
    for (let i = 0; i < userIds.length; i += PROFILE_CHUNK) chunks.push(userIds.slice(i, i + PROFILE_CHUNK))
    const profiles: Profile[] = []
    for (const res of await Promise.all(chunks.map(ids => admin.from('profiles').select('id, name, email').in('id', ids)))) {
      if (res.error) throw res.error
      profiles.push(...((res.data ?? []) as Profile[]))
    }

    const profileById = new Map(profiles.map(p => [p.id, p]))
    const swingByUser = new Map(swings.map(s => [s.user_id, s]))
    const holeById = new Map((holes.get(golfDayId) ?? []).map(h => [h.holeId, h]))

    const data = players.map(p => {
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
