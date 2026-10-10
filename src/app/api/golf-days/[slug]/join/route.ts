/**
 * POST /api/golf-days/[slug]/join
 * Body: { code? } — the golf day's join code, when it has one (migration 038)
 * Returns: { joined: true, slug, tabLabel }
 *
 * A player joins through the golf day's link. From then on their Icons tab
 * is the golf day's, and on the day they get one free swing (on a trip, one
 * every round). Joining twice is a no-op, so a second tap or a second
 * device is harmless.
 *
 * A golf day with a join code takes only players who type it (any case):
 * 403 GOLF_DAY_CODE_REQUIRED without one, GOLF_DAY_CODE_WRONG with the
 * wrong one. A golf day without a code ignores the body, as before.
 *
 * The cap and the closing of joins once the day (or a trip's last day) is
 * over are the database's (migrations 029 and 033): a trigger locks the golf day while it counts, so two
 * players taking the last place at once cannot both get it.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api/http'
import { assertNotSuspended, claimErrorResponse } from '@/lib/claims/state-machine'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { log } from '@/lib/observability/log'
import { golfDayBySlug, playerCount } from '@/lib/golf-days/load'
import {
  GOLF_DAY_REFUSALS, GOLF_DAY_SLUG_PATTERN, golfDayPhase, joinCodeMatches, refusalFromDbError, type GolfDayRefusal,
} from '@/lib/golf-days/rules'

type Ctx = { params: Promise<{ slug: string }> }

/** The body is optional: the screen sends none for a golf day without a code. */
const Body = z.object({ code: z.string().max(40).optional() })

/** What was typed, if anything. A body that is missing or not JSON is no code, not a 400. */
async function typedCode(request: Request): Promise<string | undefined> {
  const raw: unknown = await request.json().catch(() => null)
  const parsed = Body.safeParse(raw ?? {})
  return parsed.success ? parsed.data.code : undefined
}

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
    const code = await typedCode(request)

    await assertNotSuspended(supabase, user.id)

    const admin = createAdminClient()
    const day = await golfDayBySlug(admin, slug)
    if (!day) return refuse('GOLF_DAY_NOT_FOUND')
    const joined = { joined: true, slug: day.slug, tabLabel: day.tab_label }

    const { data: already, error: alreadyError } = await admin
      .from('golf_day_players').select('user_id').eq('golf_day_id', day.id).eq('user_id', user.id).maybeSingle()
    if (alreadyError) throw alreadyError
    if (already) return NextResponse.json(joined)

    // The join code, before anything else is said about the day: a forwarded
    // link without the code learns nothing more than that one is needed.
    if (day.join_code && !joinCodeMatches(day.join_code, code)) {
      const refusal: GolfDayRefusal = code?.trim() ? 'GOLF_DAY_CODE_WRONG' : 'GOLF_DAY_CODE_REQUIRED'
      log.info('golf_days.join_code_refused', { user_id: user.id, golf_day_id: day.id, reason: refusal })
      return refuse(refusal)
    }

    // The friendly answers; the insert below is where they hold.
    if (day.disabled_at) return refuse('GOLF_DAY_CLOSED')
    if (golfDayPhase(day.plays_on, Date.now(), day.ends_on ?? null) === 'over') return refuse('GOLF_DAY_OVER')
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
