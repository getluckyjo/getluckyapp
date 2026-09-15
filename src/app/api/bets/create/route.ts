import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { BET_TIERS } from '@/lib/tiers'
import { verifyPaymentAmount } from '@/lib/payments'
import { assertNotSuspended, claimErrorResponse, computeExpiresAt } from '@/lib/claims/state-machine'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import { createAdminClient } from '@/lib/supabase/admin'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { hashIdentifier } from '@/lib/risk/hash'

// The body's course, hole and tier are advisory: the authoritative values come
// from the payments ledger. They are still required so a malformed client
// fails fast rather than after a ledger round trip.
const Body = z.object({
  paymentIntentId: z.string().trim().min(1).max(100),
  tier: z.enum(BET_TIERS.map(t => t.tier) as [string, ...string[]]),
  courseId: uuid,
  holeId: uuid,
})

export async function POST(request: NextRequest) {
  try {

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const limited = await enforceRateLimit(RULES.betCreate, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited
    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { paymentIntentId } = body.data

    await assertNotSuspended(supabase, user.id)

    // ── Age gate: no real-money bet without a passed 18+ verification ──
    const { data: profile } = await supabase
      .from('profiles')
      .select('age_verified_at')
      .eq('id', user.id)
      .single()

    if (!profile?.age_verified_at) {
      return NextResponse.json(
        { error: 'Age verification required', code: 'AGE_NOT_VERIFIED' },
        { status: 403 },
      )
    }

    // ── Idempotency guard: return the existing bet if this payment already
    // produced one. payment_intent_id is our reference and is never rewritten
    // (migration 008); PayFast's id is kept separately in pf_payment_id.
    const { data: existing } = await supabase
      .from('bets')
      .select('id')
      .eq('payment_intent_id', paymentIntentId)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ betId: existing.id })
    }

    // ── Proof of payment ──────────────────────────────────────────────────
    // The browser is not trusted here. A bet only exists once the PayFast ITN
    // has written a verified row to the payments ledger — signature-checked,
    // phoned home to PayFast, and amount-matched against the tier. Before this,
    // any POST with an invented reference produced a live bet for free.
    const { data: payment, error: payErr } = await supabase
      .from('payfast_payments')
      .select('m_payment_id, pf_payment_id, user_id, course_id, hole_id, tier, amount_cents, status')
      .eq('m_payment_id', paymentIntentId)
      .maybeSingle()

    if (payErr) {
      await alertOps({ event: 'bets.create.ledger_lookup_failed', path: 'bets_create', summary: 'Could not read the payments ledger; paid golfers cannot get their bet.', details: { user_id: user.id, m_payment_id: paymentIntentId }, err: payErr })
      return NextResponse.json(
        { error: 'Could not verify payment', code: 'PAYMENT_LOOKUP_FAILED' },
        { status: 500 },
      )
    }

    if (!payment) {
      // Either the ITN has not landed yet (common — PayFast often beats the
      // browser back) or no such payment exists. Both are "not yet", not an
      // error: the client polls. Never fall through to creating a bet.
      return NextResponse.json(
        { error: 'Waiting for payment confirmation', code: 'PAYMENT_PENDING' },
        { status: 202 },
      )
    }

    if (payment.status !== 'complete') {
      log.warn('bets.create.refused_payment_status', { user_id: user.id, m_payment_id: paymentIntentId, status: payment.status })
      return NextResponse.json(
        { error: 'Payment could not be verified', code: 'PAYMENT_NOT_VERIFIED' },
        { status: 402 },
      )
    }

    if (payment.user_id !== user.id) {
      log.warn('bets.create.refused_wrong_user', { user_id: user.id, m_payment_id: paymentIntentId, ledger_user_id: payment.user_id })
      return NextResponse.json(
        { error: 'Payment could not be verified', code: 'PAYMENT_NOT_VERIFIED' },
        { status: 402 },
      )
    }

    // Legacy safety: a bet created before migration 008 may still carry
    // PayFast's id as its reference. Find it by that rather than duplicate.
    if (payment.pf_payment_id) {
      const { data: legacy } = await supabase
        .from('bets')
        .select('id')
        .eq('pf_payment_id', payment.pf_payment_id)
        .maybeSingle()
      if (legacy) return NextResponse.json({ betId: legacy.id })
    }

    // Course, hole and tier come from the signed PayFast payload the ITN
    // recorded, not from the request body — so they cannot be swapped for a
    // bigger prize after paying for a smaller one. If the ITN did not carry
    // them, the payment cannot be matched to a hole and no bet is granted.
    const amountCheck = verifyPaymentAmount(payment.tier ?? '', payment.amount_cents)
    const paidTier = BET_TIERS.find(t => t.tier === payment.tier)
    if (!amountCheck.ok || !paidTier) {
      log.warn('bets.create.refused_tier_amount', { user_id: user.id, m_payment_id: paymentIntentId, tier: payment.tier, amount_cents: payment.amount_cents })
      return NextResponse.json(
        { error: 'Payment could not be verified', code: 'PAYMENT_NOT_VERIFIED' },
        { status: 402 },
      )
    }
    if (!payment.course_id || !payment.hole_id) {
      await alertOps({ event: 'bets.create.ledger_missing_target', path: 'bets_create', summary: 'A complete payment has no course/hole in its signed payload; no bet granted. Needs manual reconciliation.', details: { user_id: user.id, m_payment_id: paymentIntentId } })
      return NextResponse.json(
        { error: 'Payment could not be matched to a hole. Please contact support.', code: 'PAYMENT_UNMATCHED' },
        { status: 402 },
      )
    }

    // Writes go through the service role: migration 006 removed the client
    // insert policy on bets. Ownership is fixed above (the ledger row is the
    // caller's) and user_id is taken from the session, never the body.
    const admin = createAdminClient()
    const { data: bet, error } = await admin
      .from('bets')
      .insert({
        created_ip_hash: hashIdentifier('ip', clientIp(request)),
        user_id:             user.id,
        course_id:           payment.course_id,
        hole_id:             payment.hole_id,
        pf_payment_id:       payment.pf_payment_id ?? null,
        tier:                paidTier.tier,
        stake_pence:         paidTier.stakeZAR * 100,
        potential_win_pence: paidTier.winZAR   * 100,
        payment_intent_id:   paymentIntentId,
        status:              'active',
        expires_at:          computeExpiresAt(),
        updated_by:          user.id,
      })
      .select('id')
      .single()

    if (error) {
      // Unique violation — a concurrent request won the race. Read theirs back.
      if (error.code === '23505') {
        const { data: duplicate } = await supabase
          .from('bets')
          .select('id')
          .eq('payment_intent_id', paymentIntentId)
          .maybeSingle()
        if (duplicate) {
          return NextResponse.json({ betId: duplicate.id })
        }
      }
      await alertOps({ event: 'bets.create.insert_failed', path: 'bets_create', summary: 'A verified payment could not be turned into a bet.', details: { user_id: user.id, m_payment_id: paymentIntentId, code: error.code, details: error.details }, err: error })
      return apiError('bets.create.insert_failed', error, { path: 'bets_create', message: 'Could not create your bet. Please contact support.' })
    }

    // Link the ledger row to the bet it produced (reconciliation), and bump
    // the attempt counter. Both best-effort: the bet exists either way.
    const { error: linkErr } = await admin
      .from('payfast_payments')
      .update({ bet_id: bet.id })
      .eq('m_payment_id', paymentIntentId)
    if (linkErr) log.warn('bets.create.ledger_link_failed', { bet_id: bet.id, m_payment_id: paymentIntentId, error: linkErr.message })
    const { error: rpcErr } = await admin.rpc('increment_attempts', { user_id: user.id })
    if (rpcErr) log.warn('bets.create.attempt_counter_failed', { user_id: user.id, error: rpcErr.message })

    log.info('bets.create.created', { user_id: user.id, bet_id: bet.id, m_payment_id: paymentIntentId, tier: paidTier.tier })
    return NextResponse.json({ betId: bet.id })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('bets.create.unhandled', err, { path: 'bets_create' })
  }
}
