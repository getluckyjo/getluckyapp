/**
 * Write Stitch's answer about a transaction into the ledger, once.
 *
 * Shared by the webhook (Stitch tells us) and the reconciliation cron (we
 * ask Stitch). Every write is conditional on the row's current status, so
 * the charge route, the webhook and the cron can all speak and the first
 * definite answer stands:
 *
 *   SUCCESS, amount matches the tier → 'complete' (from pending/unknown),
 *                                      then grantBetForPayment (idempotent)
 *   SUCCESS, amount differs          → 'amount_mismatch', ops alert, no bet
 *   FAILURE / CANCELLED / EXPIRED    → 'failed' (from pending/unknown only)
 *   PENDING or unknown status        → nothing written
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { grantBetForPayment } from '@/lib/claims/grant'
import { verifyPaymentAmount } from '@/lib/payments'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import type { Json } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

export type SettleResult = 'completed' | 'already_complete' | 'failed' | 'mismatched' | 'no_row' | 'noop' | 'write_failed'

export interface SettleInput {
  reference: string
  stitchId: string
  status: string
  reason: string | null
  amountCents: number | null
  source: 'webhook' | 'reconcile'
}

export async function settleStitchTransaction(admin: Admin, input: SettleInput): Promise<SettleResult> {
  const { data: row, error } = await admin
    .from('payfast_payments')
    .select('m_payment_id, user_id, tier, amount_cents, status, provider, raw_payload')
    .eq('m_payment_id', input.reference)
    .maybeSingle()
  if (error) throw error
  if (!row) {
    log.warn('stitch.settle.no_row', { reference: input.reference, stitch_id: input.stitchId, status: input.status, source: input.source })
    return 'no_row'
  }
  if (row.provider !== 'stitch') {
    log.warn('stitch.settle.wrong_provider', { reference: input.reference, provider: row.provider, source: input.source })
    return 'noop'
  }
  const payload = row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload) ? row.raw_payload as Record<string, Json> : {}
  const stamp = { [`${input.source}_at`]: new Date().toISOString(), stitch_id: input.stitchId, stitch_status: input.status, ...(input.reason ? { stitch_reason: input.reason } : {}) }
  const status = input.status.toUpperCase()

  if (status === 'SUCCESS') {
    if (row.status === 'complete') {
      const { error: refErr } = await admin.from('payfast_payments').update({ provider_ref: input.stitchId }).eq('m_payment_id', input.reference).is('provider_ref', null)
      if (refErr) log.warn('stitch.settle.ref_write_failed', { reference: input.reference, error: refErr.message })
      // The charge route may have completed the row but not managed the bet; try again.
      const granted = await grantBetForPayment(admin, input.reference, { source: input.source === 'webhook' ? 'itn' : 'reconcile', createdIpHash: null })
      if (!granted.ok) log.info('stitch.settle.bet_not_granted', { reference: input.reference, reason: granted.reason, source: input.source })
      return 'already_complete'
    }
    if (row.status !== 'pending' && row.status !== 'unknown') return 'noop'

    const amountCents = input.amountCents
    const check = amountCents === null ? { ok: true } : verifyPaymentAmount(row.tier ?? '', amountCents)
    const matches = check.ok && (amountCents === null || amountCents === row.amount_cents)
    const next = matches ? 'complete' : 'amount_mismatch'
    const { data: updated, error: updErr } = await admin
      .from('payfast_payments')
      .update({ status: next, provider_ref: input.stitchId, raw_payload: { ...payload, ...stamp, ...(amountCents !== null ? { stitch_amount_cents: amountCents } : {}) } })
      .eq('m_payment_id', input.reference)
      .in('status', ['pending', 'unknown'])
      .select('m_payment_id')
    if (updErr) { log.warn('stitch.settle.write_failed', { reference: input.reference, error: updErr.message }); return 'write_failed' }
    if (!updated || updated.length === 0) return 'noop'

    if (!matches) {
      await alertOps({
        event: 'stitch.settle.amount_mismatch',
        path: 'payfast_itn',
        summary: `Stitch reports ${input.reference} paid for ${amountCents}c against tier ${row.tier ?? '(none)'} (expected ${row.amount_cents}c). No bet granted; ledger row marked amount_mismatch.`,
        details: { reference: input.reference, user_id: row.user_id, stitch_id: input.stitchId, amount_cents: amountCents, expected_cents: row.amount_cents },
      })
      return 'mismatched'
    }
    log.info('stitch.settle.completed', { reference: input.reference, user_id: row.user_id, stitch_id: input.stitchId, source: input.source, from: row.status })
    try {
      const granted = await grantBetForPayment(admin, input.reference, { source: input.source === 'webhook' ? 'itn' : 'reconcile', createdIpHash: null })
      if (!granted.ok) log.info('stitch.settle.bet_not_granted', { reference: input.reference, reason: granted.reason, source: input.source })
    } catch (grantErr) {
      await alertOps({ event: 'stitch.settle.grant_failed', path: 'payfast_itn', summary: `Payment ${input.reference} is complete but the bet could not be granted; Home will retry.`, details: { reference: input.reference, user_id: row.user_id }, err: grantErr })
    }
    return 'completed'
  }

  if (status === 'FAILURE' || status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED') {
    if (row.status !== 'pending' && row.status !== 'unknown') return 'noop'
    const { data: updated, error: updErr } = await admin
      .from('payfast_payments')
      .update({ status: 'failed', provider_ref: input.stitchId, raw_payload: { ...payload, ...stamp } })
      .eq('m_payment_id', input.reference)
      .in('status', ['pending', 'unknown'])
      .select('m_payment_id')
    if (updErr) { log.warn('stitch.settle.write_failed', { reference: input.reference, error: updErr.message }); return 'write_failed' }
    if (!updated || updated.length === 0) return 'noop'
    log.info('stitch.settle.failed', { reference: input.reference, user_id: row.user_id, stitch_id: input.stitchId, reason: input.reason, source: input.source })
    return 'failed'
  }

  log.info('stitch.settle.pending', { reference: input.reference, stitch_id: input.stitchId, status: input.status, source: input.source })
  return 'noop'
}
