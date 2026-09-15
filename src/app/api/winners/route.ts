import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'

/**
 * GET /api/winners — public, anonymised list of paid-out hole-in-ones.
 *
 * Only bets with status `paid` appear: a prize that has actually been paid
 * after review. Names are reduced to "First L." and nothing else about the
 * player is exposed. Replaces the fictional list the leaderboard used to
 * ship with (AUDIT.md B.11).
 */
export interface PublicWinner {
  id: string
  name: string
  initials: string
  amountCents: number
  stakeCents: number
  course: string
  paidAt: string
}

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' }

export async function GET() {
  try {
    const admin = createAdminClient()
    const { data: bets, error } = await admin
      .from('bets')
      .select('id, user_id, course_id, potential_win_pence, stake_pence, declared_at, updated_at, created_at')
      .eq('status', 'paid')
      .order('potential_win_pence', { ascending: false })
      .limit(100)
    if (error) throw error

    const rows = bets ?? []
    const userIds = [...new Set(rows.map(b => b.user_id).filter(Boolean))]
    const courseIds = [...new Set(rows.map(b => b.course_id).filter(Boolean))]

    const [profilesRes, coursesRes] = await Promise.all([
      userIds.length ? admin.from('profiles').select('id, name').in('id', userIds) : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
      courseIds.length ? admin.from('courses').select('id, name').in('id', courseIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ])
    const names = new Map((profilesRes.data ?? []).map(p => [p.id, p.name as string | null]))
    const courses = new Map((coursesRes.data ?? []).map(c => [c.id, c.name as string]))

    const winners: PublicWinner[] = rows.map(b => {
      const { display, initials } = anonymise(names.get(b.user_id) ?? null)
      return {
        id: b.id,
        name: display,
        initials,
        amountCents: b.potential_win_pence ?? 0,
        stakeCents: b.stake_pence ?? 0,
        course: courses.get(b.course_id) ?? 'Partner course',
        paidAt: (b.updated_at ?? b.declared_at ?? b.created_at) as string,
      }
    })

    const totalPaidOutCents = winners.reduce((s, w) => s + w.amountCents, 0)
    return NextResponse.json({ winners, totalPaidOutCents }, { headers: CACHE_HEADERS })
  } catch (err) {
    log.error('winners.failed', err)
    return NextResponse.json({ winners: [], totalPaidOutCents: 0 }, { headers: CACHE_HEADERS })
  }
}

/** "Thabo Mokoena" → { display: "Thabo M.", initials: "TM" }. Unknown → "A golfer" / "GL". */
export function anonymise(name: string | null): { display: string; initials: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { display: 'A golfer', initials: 'GL' }
  const first = parts[0]
  const lastInitial = parts.length > 1 ? parts[parts.length - 1][0].toUpperCase() : ''
  return {
    display: lastInitial ? `${first} ${lastInitial}.` : first,
    initials: `${first[0]}${lastInitial}`.toUpperCase(),
  }
}
