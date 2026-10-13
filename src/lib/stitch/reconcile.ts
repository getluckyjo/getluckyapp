/**
 * Settle wallet charges Stitch never answered for.
 *
 * A wallet charge whose answer never arrived (a timeout, a dropped
 * connection) is a ledger row in status 'unknown' with provider 'stitch';
 * a 3-D Secure step the golfer abandoned is one still 'pending'. The
 * webhook usually settles both within seconds. For the rest, this runs
 * from the outbox cron every minute and asks Stitch for each row older
 * than two minutes, by our reference:
 *
 *   found, SUCCESS  → settleStitchTransaction completes it (amount checked)
 *   found, FAILURE  → 'failed'
 *   found, PENDING  → left for the next run, until it is a day old
 *   not found       → 'failed' once it is ten minutes old: nothing was taken
 *   Stitch unreachable → left for the next run. Never guessed.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { log } from '@/lib/observability/log'
import { findTransactionByReference } from './api'
import type { StitchConfig } from './config'
import { settleStitchTransaction } from './settle'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

/** How old a row must be before Stitch is asked: the webhook gets this long first. */
export const STITCH_RECONCILE_AFTER_MS = 2 * 60_000
/** A row Stitch has no record of after this long never happened. */
export const STITCH_NOT_FOUND_AFTER_MS = 10 * 60_000
/** A 3-D Secure step left open for this long is abandoned. */
export const STITCH_PENDING_EXPIRES_MS = 24 * 60 * 60_000
export const STITCH_RECONCILE_LIMIT = 25

export interface StitchReconcileResult {
  checked: number
  completed: number
  mismatched: number
  failed: number
  left: number
}

export async function reconcileStitchPayments(admin: Admin, config: StitchConfig, opts: { now?: Date; limit?: number } = {}): Promise<StitchReconcileResult> {
  const now = opts.now ?? new Date()
  const result: StitchReconcileResult = { checked: 0, completed: 0, mismatched: 0, failed: 0, left: 0 }
  const cutoff = new Date(now.getTime() - STITCH_RECONCILE_AFTER_MS).toISOString()

  const { data, error } = await admin
    .from('payfast_payments')
    .select('m_payment_id, user_id, status, created_at')
    .eq('provider', 'stitch')
    .in('status', ['unknown', 'pending'])
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? STITCH_RECONCILE_LIMIT)
  if (error) throw error
  const rows = (data ?? []) as { m_payment_id: string; user_id: string | null; status: string; created_at: string }[]

  for (const row of rows) {
    result.checked++
    const age = now.getTime() - Date.parse(row.created_at)

    let lookup
    try {
      lookup = await findTransactionByReference(config, row.m_payment_id)
    } catch (err) {
      result.left++
      log.warn('stitch.reconcile.unreachable', { m_payment_id: row.m_payment_id, error: err instanceof Error ? err.message : String(err) })
      continue
    }

    if (!lookup.found) {
      if (age < STITCH_NOT_FOUND_AFTER_MS) { result.left++; continue }
      const settled = await settleStitchTransaction(admin, { reference: row.m_payment_id, stitchId: '', status: 'FAILURE', reason: 'not_found_at_stitch', amountCents: null, source: 'reconcile' })
      if (settled === 'failed') result.failed++; else result.left++
      continue
    }

    if (lookup.state === 'pending') {
      if (age < STITCH_PENDING_EXPIRES_MS) { result.left++; continue }
      const settled = await settleStitchTransaction(admin, { reference: row.m_payment_id, stitchId: lookup.id, status: 'FAILURE', reason: 'abandoned', amountCents: null, source: 'reconcile' })
      if (settled === 'failed') result.failed++; else result.left++
      continue
    }

    const settled = await settleStitchTransaction(admin, {
      reference: row.m_payment_id,
      stitchId: lookup.id,
      status: lookup.state === 'success' ? 'SUCCESS' : 'FAILURE',
      reason: lookup.reason,
      amountCents: lookup.amountCents,
      source: 'reconcile',
    })
    if (settled === 'completed' || settled === 'already_complete') result.completed++
    else if (settled === 'mismatched') result.mismatched++
    else if (settled === 'failed') result.failed++
    else result.left++
  }

  if (result.checked > 0) log.info('stitch.reconcile.run', { ...result })
  return result
}
