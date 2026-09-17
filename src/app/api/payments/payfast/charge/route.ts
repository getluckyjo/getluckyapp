import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotSuspended, claimErrorResponse } from '@/lib/claims/state-machine'
import { grantBetForPayment } from '@/lib/claims/grant'
import { resolvePayfastConfig } from '@/lib/payfast/config'
import { chargeToken } from '@/lib/payfast/api'
import { checkTarget } from '@/lib/payfast/target'
import { BET_TIERS } from '@/lib/tiers'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { hashIdentifier } from '@/lib/risk/hash'
import { log } from '@/lib/observability/log'
import type { Json } from '@/types/database'
import { alertOps } from '@/lib/observability/alerts'

const Body = z.object({
  tier: z.enum(BET_TIERS.map(t => t.tier) as [string, ...string[]]),
  courseId: uuid,
  holeId: uuid,
})

/**
 * POST /api/payments/payfast/charge — pay with the saved card, in one call.
 * Body: { tier, courseId, holeId }. Returns { betId, m_payment_id }.
 *
 * Same gates as the checkout (session, not suspended, rate limit, the hole
 * rule, an open course); the amount comes from the tier. The ledger row is
 * written first, as 'pending', with the user, course, hole and tier, so the
 * ITN PayFast sends afterwards (which echoes the FIRST payment's custom
 * fields) can never attach this payment to the wrong hole. Then PayFast is
 * asked to charge the token; on success the row is 'complete' and the bet
 * is granted here and now; on refusal the row is 'failed' and the golfer is
 * offered the ordinary checkout.
 */
export async function POST(request: NextRequest) {
  try {
    const cfg = resolvePayfastConfig()
    if (!cfg.ok) {
      await alertOps({ event: 'payfast.charge.misconfigured', path: 'payfast_checkout', summary: `Saved-card charge refused: ${cfg.reason}` })
      return NextResponse.json({ error: 'Payments are not available right now.', code: 'PAYMENTS_UNAVAILABLE' }, { status: 503 })
    }
    const config = cfg.config

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    const limited = await enforceRateLimit(RULES.checkout, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited
    await assertNotSuspended(supabase, user.id)

    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { tier, courseId, holeId } = body.data
    const tierData = BET_TIERS.find(t => t.tier === tier)!

    const refused = await checkTarget(supabase, courseId, holeId)
    if (refused) return refused

    const admin = createAdminClient()
    const { data: card } = await admin.from('payment_cards').select('token').eq('user_id', user.id).maybeSingle()
    if (!card) return NextResponse.json({ error: 'No saved card', code: 'NO_SAVED_CARD' }, { status: 404 })

    const mPaymentId = `gl_${randomUUID()}`
    const amountCents = tierData.stakeZAR * 100

    const { error: ledgerErr } = await admin.from('payfast_payments').insert({
      m_payment_id: mPaymentId,
      user_id: user.id,
      course_id: courseId,
      hole_id: holeId,
      tier: tierData.tier,
      amount_cents: amountCents,
      status: 'pending',
      raw_payload: { source: 'saved_card' },
    })
    if (ledgerErr) {
      await alertOps({ event: 'payfast.charge.ledger_write_failed', path: 'payfast_checkout', summary: 'Could not write the pending ledger row before a saved-card charge; nothing was charged.', details: { user_id: user.id, m_payment_id: mPaymentId }, err: ledgerErr })
      return apiError('payfast.charge.ledger_write_failed', ledgerErr, { path: 'payfast_checkout', message: 'Could not start the payment. Please try again.' })
    }

    let charge
    try {
      charge = await chargeToken(config, card.token, { amountCents, itemName: `Get Lucky Golf - R${tierData.stakeZAR} Entry`, mPaymentId })
    } catch (err) {
      await admin.from('payfast_payments').update({ status: 'failed', raw_payload: { source: 'saved_card', error: err instanceof Error ? err.message : String(err) } }).eq('m_payment_id', mPaymentId)
      log.warn('payfast.charge.unreachable', { user_id: user.id, m_payment_id: mPaymentId, error: err instanceof Error ? err.message : String(err) })
      return NextResponse.json({ error: 'PayFast could not be reached. Please pay the usual way.', code: 'CHARGE_UNAVAILABLE' }, { status: 502 })
    }

    if (!charge.ok) {
      await admin.from('payfast_payments').update({ status: 'failed', raw_payload: { source: 'saved_card', response: charge.raw as Json } }).eq('m_payment_id', mPaymentId)
      log.warn('payfast.charge.declined', { user_id: user.id, m_payment_id: mPaymentId, status: charge.status, code: charge.code, message: charge.message })
      return NextResponse.json(
        { error: charge.message ? `Your saved card was not charged: ${charge.message}` : 'Your saved card was not charged.', code: 'CARD_DECLINED' },
        { status: 402 },
      )
    }

    // Paid. The ITN will confirm again; the row is already complete so it
    // only attaches PayFast's id. Grant the bet now, on the same rules as
    // every other payment.
    const { error: completeErr } = await admin
      .from('payfast_payments')
      .update({ status: 'complete', pf_payment_id: charge.pfPaymentId, raw_payload: { source: 'saved_card', response: charge.raw as Json } })
      .eq('m_payment_id', mPaymentId)
    if (completeErr) {
      await alertOps({ event: 'payfast.charge.complete_write_failed', path: 'payfast_checkout', summary: `Saved card charged for ${mPaymentId} but the ledger could not be marked complete; the ITN will. Watch for the bet.`, details: { user_id: user.id, m_payment_id: mPaymentId }, err: completeErr })
    }
    await admin.from('payment_cards').update({ last_used_at: new Date().toISOString() }).eq('user_id', user.id)

    const granted = await grantBetForPayment(admin, mPaymentId, { source: 'return', createdIpHash: hashIdentifier('ip', clientIp(request)) })
    if (!granted.ok) {
      // Charged but no bet (age not verified, for instance). The ledger row
      // is complete; Home's card and the return page pick it up.
      log.warn('payfast.charge.bet_not_granted', { user_id: user.id, m_payment_id: mPaymentId, reason: granted.reason })
      return NextResponse.json({ error: 'Paid, but your shot could not be set up yet.', code: granted.reason, m_payment_id: mPaymentId }, { status: 409 })
    }

    log.info('payfast.charge.completed', { user_id: user.id, m_payment_id: mPaymentId, bet_id: granted.betId, tier: tierData.tier, amount_cents: amountCents })
    return NextResponse.json({ betId: granted.betId, m_payment_id: mPaymentId })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('payfast.charge.failed', err, { path: 'payfast_checkout', message: 'Could not charge your saved card. Please try again.' })
  }
}
