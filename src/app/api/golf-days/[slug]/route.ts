/**
 * GET /api/golf-days/[slug]
 * Returns: { golfDay: PublicGolfDay, me: GolfDayMe | null }
 *
 * What the golf day screen shows. Open to a signed-out visitor, because the
 * link is how players first meet it: they see the day (or a trip's days),
 * the prize and the holes before they sign in. `me` is null until they do;
 * then it carries every swing they took (one a round on a trip).
 *
 * The number of players is not shown, only whether the day is full. A join
 * code (migration 038) is never sent; only that one is needed.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api/http'
import { golfDayBySlug, golfDayFacts, holesFor, playerCount } from '@/lib/golf-days/load'
import { parseLook } from '@/lib/golf-days/look'
import { GOLF_DAY_REFUSALS, GOLF_DAY_SLUG_PATTERN, golfDayPhase, type GolfDayMe, type PublicGolfDay } from '@/lib/golf-days/rules'

type Ctx = { params: Promise<{ slug: string }> }

const notFound = () => NextResponse.json(
  { error: GOLF_DAY_REFUSALS.GOLF_DAY_NOT_FOUND.error, code: 'GOLF_DAY_NOT_FOUND' },
  { status: 404 },
)

export async function GET(_request: Request, { params }: Ctx) {
  const { slug } = await params
  if (!GOLF_DAY_SLUG_PATTERN.test(slug)) return notFound()

  try {
    const admin = createAdminClient()
    const day = await golfDayBySlug(admin, slug)
    if (!day) return notFound()

    const [holes, players] = await Promise.all([holesFor(admin, [day.id]), playerCount(admin, day.id)])
    const facts = golfDayFacts(day)
    const golfDay: PublicGolfDay = {
      slug: day.slug,
      name: day.name,
      tabLabel: day.tab_label,
      ...facts,
      phase: golfDayPhase(facts.playsOn, Date.now(), facts.endsOn),
      closed: Boolean(day.disabled_at),
      full: players >= day.max_players,
      requiresCode: Boolean(day.join_code),
      holes: holes.get(day.id) ?? [],
      look: parseLook(day.look),
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    let me: GolfDayMe | null = null
    if (user) {
      const [{ data: joined, error: joinedError }, { data: profile }, { data: swings }] = await Promise.all([
        admin.from('golf_day_players').select('user_id').eq('golf_day_id', day.id).eq('user_id', user.id).maybeSingle(),
        supabase.from('profiles').select('age_verified_at').eq('id', user.id).maybeSingle(),
        supabase.from('bets').select('id, status, hole_id, expires_at').eq('user_id', user.id).eq('golf_day_id', day.id)
          .order('created_at', { ascending: true }).limit(50),
      ])
      if (joinedError) throw joinedError
      type Swing = { id: string; status: string; hole_id: string; expires_at: string | null }
      me = {
        joined: Boolean(joined),
        ageVerified: Boolean(profile?.age_verified_at),
        swings: ((swings ?? []) as Swing[]).map(s => ({
          betId: s.id,
          status: s.status,
          holeId: s.hole_id,
          open: !s.expires_at || Date.parse(s.expires_at) > Date.now(),
        })),
      }
    }

    return NextResponse.json({ golfDay, me })
  } catch (err) {
    return apiError('golf_days.read_failed', err)
  }
}
