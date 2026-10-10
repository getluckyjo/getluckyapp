/**
 * The free swing — the freemium way in.
 *
 * One per account, for life: no stake, a real R10,000 prize, and from the
 * moment it is granted it is an ordinary bet. The same record screen, the
 * same footage sealing, the same claim and the same review. A golfer can
 * play the whole thing once before spending anything.
 *
 * It deliberately does not touch the money path. There is no R0 checkout and
 * no ledger row: /api/payments/* validates against BET_TIERS, which does not
 * contain this tier, so a free entry cannot be bought, refunded or matched to
 * a payment. This route is the only way one is ever created.
 *
 * The gates are the paid ones minus the payment: signed in, 18+ verified, not
 * suspended, and a real active par-3 at a partner course. The one-per-account
 * rule is held by the database (migration 023, plus the deterministic
 * `free_<user id>` reference on the existing unique index), not by the check
 * below — two taps at once must not become two free prizes.
 *
 * How many a day, system-wide, is the database's too (migration 038): a
 * trigger locks the one caps row, counts today's free swings and refuses
 * with FREE_SWING_CAP, or FREE_SWING_PAUSED when an admin has paused them.
 * Both come back to the golfer as a 503, "try again tomorrow". The same
 * answer comes straight from the route, before the database is asked
 * anything, when FREE_SWING_PAUSED=on is set in the environment.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { FREE_TIER } from '@/lib/tiers'
import { assertNotSuspended, claimErrorResponse, computeExpiresAt } from '@/lib/claims/state-machine'
import { checkTarget } from '@/lib/payfast/target'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { log } from '@/lib/observability/log'
import { z } from 'zod'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { hashIdentifier } from '@/lib/risk/hash'
import { FREE_SWING_CAP_MESSAGE, capRefusalFromDbError, envPaused, readFreeSwingCap, type FreeSwingCapRefusal } from '@/lib/free-swing-cap'

const Body = z.object({
  courseId: uuid,
  holeId: uuid,
})

/** The reference a free bet carries. Deterministic, so the unique index on
 *  payment_intent_id is a second lock on "one per account". */
export function freeSwingReference(userId: string): string {
  return `free_${userId}`
}

const TIER = {
  tier: FREE_TIER.tier,
  stakeZAR: FREE_TIER.stakeZAR,
  winZAR: FREE_TIER.winZAR,
  label: FREE_TIER.label,
}

/** The day's free swings are gone, or they are paused: the same answer either way. */
function fullyBooked(refusal: FreeSwingCapRefusal): NextResponse {
  return NextResponse.json({ error: FREE_SWING_CAP_MESSAGE, code: refusal }, { status: 503 })
}

/**
 * GET /api/bets/free
 * Returns: { eligible, used, ageVerified, reason?, tier }
 *
 * What the choose-stake screen asks before it offers the card, so nobody is
 * shown a free swing they have already had. `reason: 'cap'` says the day's
 * free swings are gone or paused, so the screen can say so.
 */
export async function GET() {
  try {
    // The environment switch answers before the database is asked anything.
    if (envPaused()) {
      return NextResponse.json({ eligible: false, used: false, ageVerified: false, reason: 'cap', tier: TIER })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ eligible: false, used: false, ageVerified: false, tier: TIER })
    }

    const [{ data: existing }, { data: profile }, cap] = await Promise.all([
      supabase.from('bets').select('id').eq('user_id', user.id).eq('tier', FREE_TIER.tier).limit(1).maybeSingle(),
      supabase.from('profiles').select('age_verified_at, suspended_at').eq('id', user.id).maybeSingle(),
      readFreeSwingCap(createAdminClient()),
    ])

    const used = Boolean(existing)
    const ageVerified = Boolean(profile?.age_verified_at)
    // A swing already taken is said first: the cap is only news to someone who still has theirs.
    const capped = !used && !cap.open
    return NextResponse.json({
      // Age is a step the golfer can still take, so it does not make them
      // ineligible — the screen sends them to /age-check and back.
      eligible: !used && !profile?.suspended_at && !capped,
      used,
      ageVerified,
      ...(capped ? { reason: 'cap' } : {}),
      tier: TIER,
    })
  } catch (err) {
    return apiError('bets.free.status_failed', err, { path: 'bets_create' })
  }
}

/**
 * POST /api/bets/free
 * Body: { courseId, holeId }
 * Returns: { betId, tier } — ready to record, exactly like a paid entry.
 */
export async function POST(request: NextRequest) {
  try {
    // The kill switch, before the database (the rate limiter included) is touched.
    if (envPaused()) {
      log.warn('bets.free.paused_by_env', {})
      return fullyBooked('FREE_SWING_PAUSED')
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const limited = await enforceRateLimit(RULES.freeSwing, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited

    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { courseId, holeId } = body.data

    await assertNotSuspended(supabase, user.id)

    // ── 18+, same as any other entry. The prize is real money. ──
    const { data: profile } = await supabase
      .from('profiles')
      .select('age_verified_at')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.age_verified_at) {
      return NextResponse.json(
        { error: 'Age verification required', code: 'AGE_NOT_VERIFIED' },
        { status: 403 },
      )
    }

    // ── One per account. The index below is what enforces it; this is the
    // friendly answer for the ordinary case. ──
    const { data: taken } = await supabase
      .from('bets')
      .select('id')
      .eq('user_id', user.id)
      .eq('tier', FREE_TIER.tier)
      .limit(1)
      .maybeSingle()

    if (taken) {
      return NextResponse.json(
        { error: 'You have already played your free swing. Choose a stake to play again.', code: 'FREE_SWING_USED' },
        { status: 409 },
      )
    }

    // ── The target must be a real, active, long-enough par-3 at a partner course ──
    const refused = await checkTarget(supabase, courseId, holeId)
    if (refused) return refused

    const admin = createAdminClient()
    const { data: bet, error } = await admin
      .from('bets')
      .insert({
        created_ip_hash:     hashIdentifier('ip', clientIp(request)),
        user_id:             user.id,
        course_id:           courseId,
        hole_id:             holeId,
        tier:                FREE_TIER.tier,
        stake_pence:         0,
        potential_win_pence: FREE_TIER.winZAR * 100,
        payment_intent_id:   freeSwingReference(user.id),
        status:              'active',
        expires_at:          computeExpiresAt(),
        updated_by:          user.id,
      })
      .select('id')
      .single()

    if (error) {
      // 23505: either index caught a second free swing — a double tap, or a
      // second device. Not an error worth a 500.
      if (error.code === '23505') {
        log.info('bets.free.duplicate_refused', { user_id: user.id })
        return NextResponse.json(
          { error: 'You have already played your free swing. Choose a stake to play again.', code: 'FREE_SWING_USED' },
          { status: 409 },
        )
      }
      // The day's cap, or the pause switch (migration 038): the trigger said no.
      const capped = capRefusalFromDbError(error)
      if (capped) {
        log.info('bets.free.capped', { user_id: user.id, reason: capped })
        return fullyBooked(capped)
      }
      return apiError('bets.free.insert_failed', error, { path: 'bets_create', message: 'Could not start your free swing. Please try again.' })
    }

    const { error: rpcErr } = await admin.rpc('increment_attempts', { user_id: user.id })
    if (rpcErr) log.warn('bets.free.attempt_counter_failed', { user_id: user.id, error: rpcErr.message })

    log.info('bets.free.granted', { user_id: user.id, bet_id: bet.id, course_id: courseId, hole_id: holeId })
    return NextResponse.json({ betId: bet.id, tier: TIER })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('bets.free.unhandled', err, { path: 'bets_create' })
  }
}
