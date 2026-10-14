/**
 * POST /api/golf-days/[slug]/swing
 * Body: { holeId }
 * Returns: { betId, prize, currency, course, hole } — ready to record.
 *
 * The golf day swing: one free swing per joined player, on the day (South
 * African time), on one of the golf day's holes, for the golf day's prize.
 * On a golf trip (migration 033), one per round instead: each hole on the
 * date of its round, once, for the trip's prize in its currency.
 * From the moment it is granted it is an ordinary bet with the same record
 * screen, footage sealing, claim and review.
 *
 * It never touches the money path: tier_golf_day is not in BET_TIERS, and
 * there is no ledger row. The prize comes from the golf day, never from the
 * body.
 *
 * Every rule is the database's too (migrations 029 and 033): a unique index
 * for one swing per player (per round on a trip), a check tying the tier to
 * a golf day, and a trigger for joined / on the day / the day's hole / the
 * round's date / the day's prize and currency. The checks below give the
 * friendly answer first.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { claimErrorResponse, computeExpiresAt } from '@/lib/claims/state-machine'
import { ageRefusal, assertProfileNotSuspended, gatePlayRequest } from '@/lib/api/gate'
import { checkTarget } from '@/lib/payfast/target'
import { RULES, clientIp } from '@/lib/rate-limit'
import { log } from '@/lib/observability/log'
import { hashIdentifier } from '@/lib/risk/hash'
import { GOLF_DAY_TIER } from '@/lib/tiers'
import { golfDayBySlug, golfDayFacts, holesFor } from '@/lib/golf-days/load'
import {
  GOLF_DAY_REFUSALS, GOLF_DAY_SLUG_PATTERN, golfDayPhase, golfDaySwingReference, refusalFromDbError, todayInSouthAfrica, type GolfDayRefusal,
} from '@/lib/golf-days/rules'

type Ctx = { params: Promise<{ slug: string }> }

const Body = z.object({ holeId: uuid })

function refuse(refusal: GolfDayRefusal, extra: Record<string, unknown> = {}): NextResponse {
  const { status, error } = GOLF_DAY_REFUSALS[refusal]
  return NextResponse.json({ error, code: refusal, ...extra }, { status })
}

/**
 * "Swing already taken", with the bet it refers to. A phone that sent the
 * request twice because the first answer was lost on a bad link gets the
 * bet it made, and carries on to the recorder when it is still active.
 */
async function usedResponse(admin: ReturnType<typeof createAdminClient>, opts: { golfDayId: string; userId: string; holeId: string; trip: boolean }): Promise<NextResponse> {
  let q = admin.from('bets').select('id, status').eq('user_id', opts.userId).eq('golf_day_id', opts.golfDayId)
  if (opts.trip) q = q.eq('hole_id', opts.holeId)
  const { data: bet } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
  return refuse(opts.trip ? 'GOLF_DAY_ROUND_USED' : 'GOLF_DAY_SWING_USED', { betId: bet?.id ?? null, status: bet?.status ?? null })
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const gate = await gatePlayRequest(request, RULES.golfDay)
    if (!gate.ok) return gate.response
    const { user, supabase, profile } = gate

    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { holeId } = body.data

    const { slug } = await params
    if (!GOLF_DAY_SLUG_PATTERN.test(slug)) return refuse('GOLF_DAY_NOT_FOUND')

    assertProfileNotSuspended(profile)

    // ── 18+, same as any other entry. The prize is real money. ──
    const underage = ageRefusal(profile)
    if (underage) return underage

    const admin = createAdminClient()
    const day = await golfDayBySlug(admin, slug)
    if (!day) return refuse('GOLF_DAY_NOT_FOUND')
    if (day.disabled_at) return refuse('GOLF_DAY_CLOSED')

    const facts = golfDayFacts(day)
    const trip = facts.endsOn !== null
    const phase = golfDayPhase(facts.playsOn, Date.now(), facts.endsOn)
    if (phase === 'upcoming') return refuse('GOLF_DAY_NOT_YET')
    if (phase === 'over') return refuse('GOLF_DAY_OVER')

    // A golf day's one swing is any swing there; a trip's is the one on this hole.
    let taken = supabase.from('bets').select('id').eq('user_id', user.id).eq('golf_day_id', day.id)
    if (trip) taken = taken.eq('hole_id', holeId)
    const [{ data: joined, error: joinedError }, { data: swingTaken }, holes] = await Promise.all([
      admin.from('golf_day_players').select('user_id').eq('golf_day_id', day.id).eq('user_id', user.id).maybeSingle(),
      taken.limit(1).maybeSingle(),
      holesFor(admin, [day.id]),
    ])
    if (joinedError) throw joinedError
    if (!joined) return refuse('GOLF_DAY_NOT_JOINED')
    if (swingTaken) return usedResponse(admin, { golfDayId: day.id, userId: user.id, holeId, trip })

    const hole = (holes.get(day.id) ?? []).find(h => h.holeId === holeId)
    if (!hole) return refuse('GOLF_DAY_WRONG_HOLE')
    if (hole.playsOn && hole.playsOn !== todayInSouthAfrica()) return refuse('GOLF_DAY_WRONG_DAY')

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
        // Named only when it is not rand, so a database before migration 033 takes a golf day's swing as it did.
        ...(facts.currency !== 'ZAR' ? { prize_currency: facts.currency } : {}),
        payment_intent_id:   golfDaySwingReference(day.id, user.id, trip ? hole.holeId : undefined),
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
        return usedResponse(admin, { golfDayId: day.id, userId: user.id, holeId, trip })
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
      prize: facts.prize,
      currency: facts.currency,
      course: hole.course,
      hole: { id: hole.holeId, courseId: hole.course.id, holeNumber: hole.holeNumber, par: hole.par, distanceMetres: hole.distanceMetres ?? 0 },
    })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('golf_days.swing_failed', err, { path: 'bets_create' })
  }
}
