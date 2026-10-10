/**
 * Settle saved-card charges that got no answer.
 *
 * A charge the app sent and never heard back from (a timeout, a dropped
 * connection) is a ledger row in status 'unknown': the money may or may
 * not have moved. PayFast's ITN usually settles it within a minute. For
 * the rest, this runs from the outbox cron every minute and asks PayFast's
 * transaction history for each row older than two minutes:
 *
 *   found, right amount   → 'complete', and the bet is granted on the
 *                           usual rules (grantBetForPayment is idempotent);
 *   found, wrong amount   → 'amount_mismatch', with an ops alert;
 *   not found             → 'failed': nothing was taken, the golfer may pay;
 *   PayFast unreachable or answering something else → left 'unknown' for
 *                           the next run. Never guessed.
 *
 * Every write is conditional on the row still being 'unknown', so an ITN
 * that lands in the middle wins and nothing is overwritten.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { grantBetForPayment } from '@/lib/claims/grant'
import { verifyPaymentAmount } from '@/lib/payments'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import { queryTransaction, type ApiConfig } from '@/lib/payfast/api'
import type { Json } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

/** How old an 'unknown' row must be before PayFast is asked: the ITN gets this long first. */
export const RECONCILE_AFTER_MS = 2 * 60_000
/** Rows per run; the cron runs every minute. */
export const RECONCILE_LIMIT = 25

export interface ReconcileResult {
  checked: number
  completed: number
  mismatched: number
  failed: number
  /** Left 'unknown': PayFast could not be asked, or did not answer properly. */
  left: number
}

interface UnknownRow {
  m_payment_id: string
  user_id: string | null
  tier: string | null
  amount_cents: number
  raw_payload: Json | null
  created_at: string
}

export async function reconcileUnknownPayments(admin: Admin, config: ApiConfig, opts: { now?: Date; limit?: number } = {}): Promise<ReconcileResult> {
  const now = opts.now ?? new Date()
  const result: ReconcileResult = { checked: 0, completed: 0, mismatched: 0, failed: 0, left: 0 }
  const cutoff = new Date(now.getTime() - RECONCILE_AFTER_MS).toISOString()

  const { data, error } = await admin
    .from('payfast_payments')
    .select('m_payment_id, user_id, tier, amount_cents, raw_payload, created_at')
    .eq('status', 'unknown')
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? RECONCILE_LIMIT)
  if (error) throw error
  const rows = (data ?? []) as UnknownRow[]

  for (const row of rows) {
    result.checked++
    const payload = row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload) ? row.raw_payload : {}

    let lookup
    try {
      lookup = await queryTransaction(config, row.m_payment_id, { chargedAt: new Date(row.created_at), now })
    } catch (err) {
      result.left++
      log.warn('payfast.reconcile.unreachable', { m_payment_id: row.m_payment_id, error: err instanceof Error ? err.message : String(err) })
      continue
    }

    if (!lookup.found) {
      // PayFast has no record of it: the charge never happened. The golfer
      // may pay again; Home stops showing it as confirming.
      const { error: updErr } = await admin
        .from('payfast_payments')
        .update({ status: 'failed', raw_payload: { ...payload, reconciled_at: now.toISOString(), reconciled: 'not_found' } })
        .eq('m_payment_id', row.m_payment_id)
        .eq('status', 'unknown')
      if (updErr) { result.left++; log.warn('payfast.reconcile.write_failed', { m_payment_id: row.m_payment_id, error: updErr.message }); continue }
      result.failed++
      log.info('payfast.reconcile.failed', { m_payment_id: row.m_payment_id, user_id: row.user_id })
      continue
    }

    const check = verifyPaymentAmount(row.tier ?? '', lookup.amountCents)
    const matches = check.ok && lookup.amountCents === row.amount_cents
    const nextStatus = matches ? 'complete' : 'amount_mismatch'
    const { error: updErr } = await admin
      .from('payfast_payments')
      .update({
        status: nextStatus,
        pf_payment_id: lookup.pfPaymentId,
        raw_payload: { ...payload, reconciled_at: now.toISOString(), reconciled: 'found', transaction: { pf_payment_id: lookup.pfPaymentId, amount_cents: lookup.amountCents, type: lookup.type, date: lookup.date } },
      })
      .eq('m_payment_id', row.m_payment_id)
      .eq('status', 'unknown')
    if (updErr) { result.left++; log.warn('payfast.reconcile.write_failed', { m_payment_id: row.m_payment_id, error: updErr.message }); continue }

    if (!matches) {
      result.mismatched++
      await alertOps({
        event: 'payfast.reconcile.amount_mismatch',
        path: 'payfast_checkout',
        summary: `Saved-card charge ${row.m_payment_id} was found at PayFast for ${lookup.amountCents}c against tier ${row.tier ?? '(none)'} (expected ${row.amount_cents}c). No bet granted; ledger row marked amount_mismatch.`,
        details: { m_payment_id: row.m_payment_id, user_id: row.user_id, pf_payment_id: lookup.pfPaymentId, amount_cents: lookup.amountCents, expected_cents: row.amount_cents },
      })
      continue
    }

    result.completed++
    log.info('payfast.reconcile.completed', { m_payment_id: row.m_payment_id, user_id: row.user_id, pf_payment_id: lookup.pfPaymentId, amount_cents: lookup.amountCents })
    try {
      const granted = await grantBetForPayment(admin, row.m_payment_id, { source: 'reconcile', createdIpHash: null })
      if (!granted.ok) log.info('payfast.reconcile.bet_not_granted', { m_payment_id: row.m_payment_id, user_id: row.user_id, reason: granted.reason })
    } catch (grantErr) {
      await alertOps({ event: 'payfast.reconcile.grant_failed', path: 'payfast_checkout', summary: `Payment ${row.m_payment_id} is reconciled complete but the bet could not be granted; Home will retry.`, details: { m_payment_id: row.m_payment_id, user_id: row.user_id }, err: grantErr })
    }
  }

  if (result.checked > 0) log.info('payfast.reconcile.run', { ...result })
  return result
}
