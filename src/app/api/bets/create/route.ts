import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { BET_TIERS } from '@/lib/tiers'
import { assertNotSuspended, claimErrorResponse } from '@/lib/claims/state-machine'
import { grantBetForPayment } from '@/lib/claims/grant'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import { createAdminClient } from '@/lib/supabase/admin'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { hashIdentifier } from '@/lib/risk/hash'

// The body's course, hole and tier are advisory: the authoritative values come
// from the payments ledger. They are optional because the return page may
// only know the reference (it arrives on the PayFast return URL); when they
// are sent they are still validated so a malformed client fails fast.
const Body = z.object({
  paymentIntentId: z.string().trim().min(1).max(100),
  tier: z.enum(BET_TIERS.map(t => t.tier) as [string, ...string[]]).optional(),
  courseId: uuid.optional(),
  holeId: uuid.optional(),
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

    // Everything from here is shared with the ITN, which normally grants the
    // bet before the browser gets back: this call then just finds it.
    const granted = await grantBetForPayment(createAdminClient(), paymentIntentId, {
      source: 'return',
      createdIpHash: hashIdentifier('ip', clientIp(request)),
    })
    if (granted.ok) return NextResponse.json({ betId: granted.betId })
    switch (granted.reason) {
      case 'PAYMENT_PENDING':
        return NextResponse.json({ error: 'Waiting for payment confirmation', code: 'PAYMENT_PENDING' }, { status: 202 })
      case 'PAYMENT_UNMATCHED':
        return NextResponse.json({ error: 'Payment could not be matched to a hole. Please contact support.', code: 'PAYMENT_UNMATCHED' }, { status: 402 })
      case 'AGE_NOT_VERIFIED':
        return NextResponse.json({ error: 'Age verification required', code: 'AGE_NOT_VERIFIED' }, { status: 403 })
      case 'ACCOUNT_SUSPENDED':
        return NextResponse.json({ error: 'This account is suspended. Please contact support.', code: 'ACCOUNT_SUSPENDED' }, { status: 403 })
      case 'INSERT_FAILED':
        return apiError('bets.create.insert_failed', new Error('grant failed'), { path: 'bets_create', message: 'Could not create your bet. Please contact support.' })
      default:
        return NextResponse.json({ error: 'Payment could not be verified', code: 'PAYMENT_NOT_VERIFIED' }, { status: 402 })
    }
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('bets.create.unhandled', err, { path: 'bets_create' })
  }
}
