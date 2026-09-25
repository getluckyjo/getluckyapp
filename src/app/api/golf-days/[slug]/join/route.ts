/**
 * POST /api/golf-days/[slug]/join
 * Returns: { joined: true, slug, tabLabel }
 *
 * A player joins through the golf day's link. From then on their Icons tab
 * is the golf day's, and on the day they get one free swing. Joining twice
 * is a no-op, so a second tap or a second device is harmless.
 *
 * The cap and the closing of joins once the day is over are the database's
 * (migration 029): a trigger locks the golf day while it counts, so two
 * players taking the last place at once cannot both get it.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api/http'
import { assertNotSuspended, claimErrorResponse } from '@/lib/claims/state-machine'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { log } from '@/lib/observability/log'
import { golfDayBySlug, playerCount } from '@/lib/golf-days/load'
import { GOLF_DAY_REFUSALS, GOLF_DAY_SLUG_PATTERN, golfDayPhase, refusalFromDbError, type GolfDayRefusal } from '@/lib/golf-days/rules'

type Ctx = { params: Promise<{ slug: string }> }

function refuse(refusal: GolfDayRefusal): NextResponse {
  const { status, error } = GOLF_DAY_REFUSALS[refusal]
  return NextResponse.json({ error, code: refusal }, { status })
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const limited = await enforceRateLimit(RULES.golfDay, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited

    const { slug } = await params
    if (!GOLF_DAY_SLUG_PATTERN.test(slug)) return refuse('GOLF_DAY_NOT_FOUND')

    await assertNotSuspended(supabase, user.id)

    const admin = createAdminClient()
    const day = await golfDayBySlug(admin, slug)
    if (!day) return refuse('GOLF_DAY_NOT_FOUND')
    const joined = { joined: true, slug: day.slug, tabLabel: day.tab_label }

    const { data: already, error: alreadyError } = await admin
      .from('golf_day_players').select('user_id').eq('golf_day_id', day.id).eq('user_id', user.id).maybeSingle()
    if (alreadyError) throw alreadyError
    if (already) return NextResponse.json(joined)

    // The friendly answers; the insert below is where they hold.
    if (day.disabled_at) return refuse('GOLF_DAY_CLOSED')
    if (golfDayPhase(day.plays_on) === 'over') return refuse('GOLF_DAY_OVER')
    if (await playerCount(admin, day.id) >= day.max_players) return refuse('GOLF_DAY_FULL')

    const { error } = await admin.from('golf_day_players').insert({ golf_day_id: day.id, user_id: user.id })
    if (error) {
      // 23505: joined a moment ago on another tap or device.
      if (error.code === '23505') return NextResponse.json(joined)
      const refusal = refusalFromDbError(error)
      if (refusal) {
        log.info('golf_days.join_refused_at_insert', { user_id: user.id, golf_day_id: day.id, reason: refusal })
        return refuse(refusal)
      }
      throw error
    }

    log.info('golf_days.joined', { user_id: user.id, golf_day_id: day.id })
    return NextResponse.json(joined)
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('golf_days.join_failed', err)
  }
}
