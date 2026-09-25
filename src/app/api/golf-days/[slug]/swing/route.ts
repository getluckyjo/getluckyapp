/**
 * POST /api/golf-days/[slug]/swing
 * Body: { holeId }
 * Returns: { betId, prizeZAR, course, hole } — ready to record.
 *
 * The golf day swing: one free swing per joined player, on the day (South
 * African time), on one of the golf day's holes, for the golf day's prize.
 * From the moment it is granted it is an ordinary bet with the same record
 * screen, footage sealing, claim and review.
 *
 * It never touches the money path: tier_golf_day is not in BET_TIERS, and
 * there is no ledger row. The prize comes from the golf day, never from the
 * body.
 *
 * Every rule is the database's too (migration 029): a unique index for one
 * swing per player, a check tying the tier to a golf day, and a trigger for
 * joined / on the day / the day's hole / the day's prize. The checks below
 * give the friendly answer first.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { assertNotSuspended, claimErrorResponse, computeExpiresAt } from '@/lib/claims/state-machine'
import { checkTarget } from '@/lib/payfast/target'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { log } from '@/lib/observability/log'
import { hashIdentifier } from '@/lib/risk/hash'
import { GOLF_DAY_TIER } from '@/lib/tiers'
import { golfDayBySlug, holesFor } from '@/lib/golf-days/load'
import {
  GOLF_DAY_REFUSALS, GOLF_DAY_SLUG_PATTERN, golfDayPhase, golfDaySwingReference, refusalFromDbError, type GolfDayRefusal,
} from '@/lib/golf-days/rules'

type Ctx = { params: Promise<{ slug: string }> }

const Body = z.object({ holeId: uuid })

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

    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { holeId } = body.data

    const { slug } = await params
    if (!GOLF_DAY_SLUG_PATTERN.test(slug)) return refuse('GOLF_DAY_NOT_FOUND')

    await assertNotSuspended(supabase, user.id)

    // ── 18+, same as any other entry. The prize is real money. ──
    const { data: profile } = await supabase.from('profiles').select('age_verified_at').eq('id', user.id).maybeSingle()
    if (!profile?.age_verified_at) {
      return NextResponse.json({ error: 'Age verification required', code: 'AGE_NOT_VERIFIED' }, { status: 403 })
    }

    const admin = createAdminClient()
    const day = await golfDayBySlug(admin, slug)
    if (!day) return refuse('GOLF_DAY_NOT_FOUND')
    if (day.disabled_at) return refuse('GOLF_DAY_CLOSED')

    const phase = golfDayPhase(day.plays_on)
    if (phase === 'upcoming') return refuse('GOLF_DAY_NOT_YET')
    if (phase === 'over') return refuse('GOLF_DAY_OVER')

    const [{ data: joined, error: joinedError }, { data: taken }, holes] = await Promise.all([
      admin.from('golf_day_players').select('user_id').eq('golf_day_id', day.id).eq('user_id', user.id).maybeSingle(),
      supabase.from('bets').select('id').eq('user_id', user.id).eq('golf_day_id', day.id).limit(1).maybeSingle(),
      holesFor(admin, [day.id]),
    ])
    if (joinedError) throw joinedError
    if (!joined) return refuse('GOLF_DAY_NOT_JOINED')
    if (taken) return refuse('GOLF_DAY_SWING_USED')

    const hole = (holes.get(day.id) ?? []).find(h => h.holeId === holeId)
    if (!hole) return refuse('GOLF_DAY_WRONG_HOLE')

    // ── The same target check every entry passes ──
    const refused = await checkTarget(supabase, hole.course.id, hole.holeId)
    if (refused) return refused

    const { data: bet, error } = await admin
      .from('bets')
      .insert({
        created_ip_hash:     hashIdentifier('ip', clientIp(request)),
        user_id:             user.id,
        course_id:           hole.course.id,
        hole_id:             hole.holeId,
        tier:                GOLF_DAY_TIER.tier,
        stake_pence:         0,
        potential_win_pence: day.prize_pence,
        payment_intent_id:   golfDaySwingReference(day.id, user.id),
        golf_day_id:         day.id,
        status:              'active',
        expires_at:          computeExpiresAt(),
        updated_by:          user.id,
      })
      .select('id')
      .single()

    if (error) {
      // 23505: a double tap or a second device got there first.
      if (error.code === '23505') {
        log.info('golf_days.swing_duplicate_refused', { user_id: user.id, golf_day_id: day.id })
        return refuse('GOLF_DAY_SWING_USED')
      }
      const refusal = refusalFromDbError(error)
      if (refusal) {
        log.info('golf_days.swing_refused_at_insert', { user_id: user.id, golf_day_id: day.id, reason: refusal })
        return refuse(refusal)
      }
      return apiError('golf_days.swing_insert_failed', error, { path: 'bets_create', message: 'Could not start your swing. Please try again.' })
    }

    const { error: rpcErr } = await admin.rpc('increment_attempts', { user_id: user.id })
    if (rpcErr) log.warn('golf_days.attempt_counter_failed', { user_id: user.id, error: rpcErr.message })

    log.info('golf_days.swing_granted', { user_id: user.id, bet_id: bet.id, golf_day_id: day.id, hole_id: hole.holeId })
    return NextResponse.json({
      betId: bet.id,
      prizeZAR: Math.round(day.prize_pence / 100),
      course: hole.course,
      hole: { id: hole.holeId, courseId: hole.course.id, holeNumber: hole.holeNumber, par: hole.par, distanceMetres: hole.distanceMetres ?? 0 },
    })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('golf_days.swing_failed', err, { path: 'bets_create' })
  }
}
