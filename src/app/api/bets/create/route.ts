import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { BET_TIERS } from '@/lib/tiers'
import { verifyPaymentAmount } from '@/lib/payments'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { courseId, holeId, tier, paymentIntentId } = body

    if (!courseId || !holeId || !tier || !paymentIntentId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Body tier is advisory — the authoritative tier comes from the payments
    // ledger below. Rejecting an unknown one early still saves a round trip.
    if (!BET_TIERS.some(t => t.tier === tier)) {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

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

    // ── Idempotency guard: return existing bet if payment already processed ──
    // Matches either reference: the bet is created against m_payment_id, and the
    // ITN later swaps it for PayFast's pf_payment_id.
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
      .select('m_payment_id, user_id, course_id, hole_id, tier, amount_cents, status')
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

    // Course, hole and tier come from the signed PayFast payload the ITN
    // recorded, not from the request body — so they cannot be swapped for a
    // bigger prize after paying for a smaller one.
    const amountCheck = verifyPaymentAmount(payment.tier ?? '', payment.amount_cents)
    const paidTier = BET_TIERS.find(t => t.tier === payment.tier)
    if (!amountCheck.ok || !paidTier) {
      log.warn('bets.create.refused_tier_amount', { user_id: user.id, m_payment_id: paymentIntentId, tier: payment.tier, amount_cents: payment.amount_cents })
      return NextResponse.json(
        { error: 'Payment could not be verified', code: 'PAYMENT_NOT_VERIFIED' },
        { status: 402 },
      )
    }

    const { data: bet, error } = await supabase
      .from('bets')
      .insert({
        user_id:             user.id,
        course_id:           payment.course_id ?? courseId,
        hole_id:             payment.hole_id   ?? holeId,
        tier:                paidTier.tier,
        stake_pence:         paidTier.stakeZAR * 100,
        potential_win_pence: paidTier.winZAR   * 100,
        payment_intent_id:   paymentIntentId,
        status:              'active',
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
      return NextResponse.json({ error: 'Failed to create bet' }, { status: 500 })
    }

    // Increment total_attempts on profile — best-effort, fire-and-forget.
    try {
      await supabase.rpc('increment_attempts', { user_id: user.id })
    } catch {
      // Safe to ignore if RPC fails
    }

    log.info('bets.create.created', { user_id: user.id, bet_id: bet.id, m_payment_id: paymentIntentId, tier: paidTier.tier })
    return NextResponse.json({ betId: bet.id })
  } catch (err) {
    log.error('bets.create.unhandled', err, { path: 'bets_create' })
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
