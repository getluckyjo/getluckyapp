/**
 * The promo swing — one extra free swing per promo code.
 *
 * An admin makes a code at /admin/promos with a cap on its uses and an
 * expiry date. A golfer who has one types it on the stake screen and plays
 * one more free swing: no stake, the free swing's R10,000 prize, and from
 * the moment it is granted an ordinary bet, with the same record screen,
 * footage sealing, claim and review.
 *
 * Playing the code IS redeeming it. The swing is granted against the hole
 * already chosen, so there is no credit sitting on an account to lose,
 * expire or reconcile, and the bet row is the record of the use.
 *
 * Like the free swing it never touches the money path: tier_promo is not in
 * BET_TIERS, so it cannot be bought, refunded or matched to a payment.
 *
 * The rules belong to the database (migration 027): one use of a code per
 * golfer (a unique index, plus the deterministic `promo_<code>_<user>`
 * reference on the existing one), and the cap, expiry and off switch in a
 * trigger that locks the code while it counts. The checks below are the
 * friendly answer for the ordinary case; the insert is where they hold, so
 * two golfers taking the last use at once cannot both get it.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PROMO_TIER } from '@/lib/tiers'
import { claimErrorResponse, computeExpiresAt } from '@/lib/claims/state-machine'
import { ageRefusal, assertProfileNotSuspended, gatePlayRequest } from '@/lib/api/gate'
import { checkTarget } from '@/lib/payfast/target'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { log } from '@/lib/observability/log'
import { apiError, parseBody, parseQuery, uuid } from '@/lib/api/http'
import { hashIdentifier } from '@/lib/risk/hash'
import {
  PROMO_CODE_PATTERN, PROMO_REFUSALS, codeRefusal, normalisePromoCode, promoSwingReference, refusalFromDbError,
  type PromoCodeRow, type PromoRefusal,
} from '@/lib/promo'

const code = z.string().max(60).transform(normalisePromoCode)
const Query = z.object({ code })
const Body = z.object({ code, courseId: uuid, holeId: uuid })

const TIER = {
  tier: PROMO_TIER.tier,
  stakeZAR: PROMO_TIER.stakeZAR,
  winZAR: PROMO_TIER.winZAR,
  label: PROMO_TIER.label,
}

function refuse(refusal: PromoRefusal, extra: Record<string, unknown> = {}): NextResponse {
  const { status, error } = PROMO_REFUSALS[refusal]
  return NextResponse.json({ error, code: refusal, ...extra }, { status })
}

/**
 * "Code already used", with the bet it refers to. A phone that sent the
 * request twice because the first answer was lost on a bad link gets the
 * bet it made, and carries on to the recorder when it is still active.
 */
async function usedResponse(admin: ReturnType<typeof createAdminClient>, promoCodeId: string, userId: string): Promise<NextResponse> {
  const { data: bet } = await admin.from('bets').select('id, status').eq('user_id', userId).eq('promo_code_id', promoCodeId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return refuse('PROMO_CODE_USED', { betId: bet?.id ?? null, status: bet?.status ?? null })
}

type Found = { ok: true; code: PromoCodeRow } | { ok: false; refusal: PromoRefusal; bet?: { id: string; status: string } }

/**
 * The code, if this golfer can play it now. Codes are read with the service
 * role (the table is closed to the public API); whether this golfer has
 * already used it is read with their own client, as every ownership check is.
 */
async function lookUp(
  admin: ReturnType<typeof createAdminClient>,
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  typed: string,
): Promise<Found> {
  if (!PROMO_CODE_PATTERN.test(typed)) return { ok: false, refusal: 'PROMO_CODE_INVALID' }

  const { data: found, error } = await admin
    .from('promo_codes')
    .select('id, code, max_uses, expires_at, note, disabled_at, created_at')
    .eq('code', typed)
    .maybeSingle()
  if (error) throw error
  if (!found) return { ok: false, refusal: 'PROMO_CODE_INVALID' }

  const [{ count, error: countError }, { data: mine }] = await Promise.all([
    admin.from('bets').select('id', { count: 'exact', head: true }).eq('promo_code_id', found.id),
    supabase.from('bets').select('id, status').eq('user_id', userId).eq('promo_code_id', found.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (countError) throw countError

  // "You already had yours" is the truer answer than "they have all gone".
  // The bet rides along: a retry after a lost answer carries on to it.
  if (mine) return { ok: false, refusal: 'PROMO_CODE_USED', bet: mine }
  const refusal = codeRefusal(found, count ?? 0)
  if (refusal) return { ok: false, refusal }
  return { ok: true, code: found }
}

function logRefusal(userId: string, refusal: PromoRefusal, where: 'check' | 'play') {
  // An unknown code may be someone guessing; the rest are ordinary.
  const fields = { user_id: userId, reason: refusal, at: where }
  if (refusal === 'PROMO_CODE_INVALID') log.warn('bets.promo.refused', fields)
  else log.info('bets.promo.refused', fields)
}

/**
 * GET /api/bets/promo?code=GOLFDAY
 * Returns: { code, expiresAt, tier } when this golfer can play it,
 *          otherwise { error, code: PROMO_CODE_* }.
 *
 * What the stake screen asks when a code is typed, before it offers the
 * swing. Nothing is spent.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const limited = await enforceRateLimit(RULES.promo, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited

    const query = parseQuery(request.url, Query)
    if (!query.ok) return query.response

    const found = await lookUp(createAdminClient(), supabase, user.id, query.data.code)
    if (!found.ok) {
      logRefusal(user.id, found.refusal, 'check')
      return refuse(found.refusal, found.bet ? { betId: found.bet.id, status: found.bet.status } : {})
    }
    return NextResponse.json({ code: found.code.code, expiresAt: found.code.expires_at, tier: TIER })
  } catch (err) {
    return apiError('bets.promo.check_failed', err, { path: 'bets_create' })
  }
}

/**
 * POST /api/bets/promo
 * Body: { code, courseId, holeId }
 * Returns: { betId, code, tier } — ready to record, exactly like a paid entry.
 */
export async function POST(request: NextRequest) {
  try {
    const gate = await gatePlayRequest(request, RULES.promo)
    if (!gate.ok) return gate.response
    const { user, supabase, profile } = gate

    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { courseId, holeId } = body.data

    assertProfileNotSuspended(profile)

    // ── 18+, same as any other entry. The prize is real money. ──
    const underage = ageRefusal(profile)
    if (underage) return underage

    const admin = createAdminClient()
    const found = await lookUp(admin, supabase, user.id, body.data.code)
    if (!found.ok) {
      logRefusal(user.id, found.refusal, 'play')
      return refuse(found.refusal, found.bet ? { betId: found.bet.id, status: found.bet.status } : {})
    }
    const promo = found.code

    // ── The target must be a real, active, long-enough par-3 at a partner course ──
    const refused = await checkTarget(supabase, courseId, holeId)
    if (refused) return refused

    const { data: bet, error } = await admin
      .from('bets')
      .insert({
        created_ip_hash:     hashIdentifier('ip', clientIp(request)),
        user_id:             user.id,
        course_id:           courseId,
        hole_id:             holeId,
        tier:                PROMO_TIER.tier,
        stake_pence:         0,
        potential_win_pence: PROMO_TIER.winZAR * 100,
        payment_intent_id:   promoSwingReference(promo.id, user.id),
        promo_code_id:       promo.id,
        status:              'active',
        expires_at:          computeExpiresAt(),
        updated_by:          user.id,
      })
      .select('id')
      .single()

    if (error) {
      // 23505: this golfer already has a swing on this code — a double tap,
      // or a second device. Not an error worth a 500.
      if (error.code === '23505') {
        log.info('bets.promo.duplicate_refused', { user_id: user.id, promo_code_id: promo.id })
        return usedResponse(admin, promo.id, user.id)
      }
      // The trigger: the last use went to someone else between our count
      // and the insert, or the code was switched off or ran out of date.
      const refusal = refusalFromDbError(error)
      if (refusal) {
        log.info('bets.promo.refused_at_insert', { user_id: user.id, promo_code_id: promo.id, reason: refusal })
        return refuse(refusal)
      }
      return apiError('bets.promo.insert_failed', error, { path: 'bets_create', message: 'Could not start your promo swing. Please try again.' })
    }

    const { error: rpcErr } = await admin.rpc('increment_attempts', { user_id: user.id })
    if (rpcErr) log.warn('bets.promo.attempt_counter_failed', { user_id: user.id, error: rpcErr.message })

    log.info('bets.promo.granted', { user_id: user.id, bet_id: bet.id, promo_code_id: promo.id, course_id: courseId, hole_id: holeId })
    return NextResponse.json({ betId: bet.id, code: promo.code, tier: TIER })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('bets.promo.unhandled', err, { path: 'bets_create' })
  }
}
