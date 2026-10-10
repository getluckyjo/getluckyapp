import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody } from '@/lib/api/http'
import { resolvePayfastConfig } from '@/lib/payfast/config'
import { refundPayment } from '@/lib/payfast/api'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'

type Params = { params: Promise<{ mPaymentId: string }> }

const Body = z.object({
  /** PayFast wants 3 to 255 characters; so does the refunds table. */
  reason: z.string().trim().min(3, 'Give a reason of at least 3 characters').max(255, 'Keep the reason under 255 characters'),
})

/** Our references are `gl_<uuid>`, `gl_<tier>_<ms>` and the odd legacy form; nothing else is looked up. */
const REFERENCE = /^[A-Za-z0-9_-]{1,80}$/

/** A refund still on its way, or one PayFast accepted, blocks another request. After this long a 'requested' row is a crash, not a request in flight. */
const IN_FLIGHT_MS = 10 * 60_000

/** A bet in one of these states is a claim in progress or a prize paid; the money stays put until a person resolves that. */
const LOCKED_BET_STATUSES = new Set(['claimed', 'verified', 'paid'])

/**
 * POST /api/admin/payments/[mPaymentId]/refund — refund a payment in full
 * through PayFast. Body: { reason }.
 *
 * Refuses unless the payment took money ('complete' or 'amount_mismatch'),
 * has PayFast's id (the refund is addressed by it), has not been refunded,
 * and its bet, if any, is not claimed, verified or paid. The refunds row is
 * written as 'requested' before PayFast is asked, then 'sent' with
 * PayFast's id or 'failed' with what went wrong, and the payment gets
 * `refunded_at`. The bet is never touched: a refunded active bet is a
 * matter for the admin on the bet screen, not a side effect here.
 */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { mPaymentId } = await params
  if (!REFERENCE.test(mPaymentId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response
  const { reason } = body.data
  const admin = auth.adminClient

  try {
    const { data: payment, error: payErr } = await admin
      .from('payfast_payments')
      .select('m_payment_id, pf_payment_id, user_id, amount_cents, status, bet_id, refunded_at')
      .eq('m_payment_id', mPaymentId)
      .maybeSingle()
    if (payErr) throw payErr
    if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (payment.refunded_at) {
      return NextResponse.json({ error: 'This payment has already been refunded.', code: 'ALREADY_REFUNDED' }, { status: 409 })
    }
    if (payment.status !== 'complete' && payment.status !== 'amount_mismatch') {
      return NextResponse.json({ error: 'Only a payment that took money can be refunded.', code: 'NOT_REFUNDABLE' }, { status: 409 })
    }
    if (!payment.pf_payment_id) {
      return NextResponse.json({ error: 'PayFast has not sent its reference for this payment yet, so it cannot be refunded here. Refund it from the PayFast dashboard.', code: 'PAYFAST_ID_MISSING' }, { status: 409 })
    }

    // The bet, by the ledger link or by the reference the bet carries.
    const { data: bets, error: betErr } = await admin
      .from('bets')
      .select('id, status')
      .or(payment.bet_id ? `id.eq.${payment.bet_id},payment_intent_id.eq.${mPaymentId}` : `payment_intent_id.eq.${mPaymentId}`)
      .limit(5)
    if (betErr) throw betErr
    const locked = ((bets ?? []) as { id: string; status: string }[]).find(b => LOCKED_BET_STATUSES.has(b.status))
    if (locked) {
      return NextResponse.json({ error: `This payment's bet is ${locked.status}. Resolve the claim before refunding.`, code: 'BET_LOCKED', betId: locked.id }, { status: 409 })
    }

    const cfg = resolvePayfastConfig()
    if (!cfg.ok) {
      await alertOps({ event: 'payfast.refund.misconfigured', path: 'admin_review', summary: `Refund refused: ${cfg.reason}` })
      return NextResponse.json({ error: 'Payments are not configured, so no refund can be sent.', code: 'PAYMENTS_UNAVAILABLE' }, { status: 503 })
    }

    // One refund per payment. A failed attempt may be retried; a sent one may not.
    const { data: existing } = await admin
      .from('refunds')
      .select('id, status, created_at, updated_at')
      .eq('m_payment_id', mPaymentId)
      .maybeSingle()
    let refundId: string
    if (existing) {
      const inFlight = existing.status === 'requested' && Date.now() - Date.parse(existing.updated_at ?? existing.created_at) < IN_FLIGHT_MS
      if (existing.status === 'sent' || inFlight) {
        return NextResponse.json({ error: 'A refund for this payment has already been requested.', code: 'REFUND_EXISTS' }, { status: 409 })
      }
      const { error: retryErr } = await admin
        .from('refunds')
        .update({ status: 'requested', failure_reason: null })
        .eq('id', existing.id)
        .in('status', ['failed', 'requested'])
      if (retryErr) throw retryErr
      refundId = existing.id
    } else {
      const { data: inserted, error: insErr } = await admin
        .from('refunds')
        .insert({
          m_payment_id: mPaymentId,
          pf_payment_id: payment.pf_payment_id,
          amount_cents: payment.amount_cents,
          reason,
          status: 'requested',
          requested_by: auth.user.id,
        })
        .select('id')
        .single()
      if (insErr) {
        if (insErr.code === '23505') return NextResponse.json({ error: 'A refund for this payment has already been requested.', code: 'REFUND_EXISTS' }, { status: 409 })
        throw insErr
      }
      refundId = inserted.id
    }

    let result
    try {
      result = await refundPayment(cfg.config, payment.pf_payment_id, payment.amount_cents, reason)
    } catch (err) {
      return await refused(refundId, err instanceof Error ? err.message : String(err), 'PayFast could not be reached. Nothing was refunded; try again in a minute.')
    }
    if (!result.ok) {
      return await refused(refundId, `PayFast answered ${result.status}${result.code != null ? ` (${result.code})` : ''}${result.message ? `: ${result.message}` : ''}`, 'PayFast refused the refund. Check the payment in the PayFast dashboard.')
    }

    const refundedAt = new Date().toISOString()
    const { error: sentErr } = await admin.from('refunds').update({ status: 'sent', pf_refund_id: result.refundId }).eq('id', refundId)
    if (sentErr) log.warn('payfast.refund.record_failed', { m_payment_id: mPaymentId, refund_id: refundId, error: sentErr.message })
    const { error: markErr } = await admin.from('payfast_payments').update({ refunded_at: refundedAt }).eq('m_payment_id', mPaymentId)
    if (markErr) {
      await alertOps({ event: 'payfast.refund.mark_failed', path: 'admin_review', summary: `PayFast accepted the refund of ${mPaymentId} but the payment could not be marked refunded; mark it by hand.`, details: { m_payment_id: mPaymentId, refund_id: refundId }, err: markErr })
    }
    log.info('payfast.refund.sent', { m_payment_id: mPaymentId, pf_payment_id: payment.pf_payment_id, pf_refund_id: result.refundId, amount_cents: payment.amount_cents, user_id: payment.user_id, admin_id: auth.user.id })
    return NextResponse.json({ refund: { id: refundId, status: 'sent', pfRefundId: result.refundId, amountCents: payment.amount_cents, refundedAt } })

    /** Record the failure, tell ops, answer the admin without PayFast's words. */
    async function refused(id: string, detail: string, message: string) {
      const { error: failErr } = await admin.from('refunds').update({ status: 'failed', failure_reason: detail.slice(0, 500) }).eq('id', id)
      if (failErr) log.warn('payfast.refund.record_failed', { m_payment_id: mPaymentId, refund_id: id, error: failErr.message })
      await alertOps({
        event: 'payfast.refund.failed',
        path: 'admin_review',
        summary: `Refund of ${mPaymentId} (${payment!.amount_cents}c) was not accepted by PayFast: ${detail}`,
        details: { m_payment_id: mPaymentId, pf_payment_id: payment!.pf_payment_id, refund_id: id, amount_cents: payment!.amount_cents, admin_id: auth.ok ? auth.user.id : null },
      })
      return NextResponse.json({ error: message, code: 'REFUND_FAILED' }, { status: 502 })
    }
  } catch (err) {
    return apiError('admin.payments.refund_failed', err, { path: 'admin_review', message: 'Could not request the refund. Please try again.' })
  }
}
