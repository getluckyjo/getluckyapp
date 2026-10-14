/**
 * A retried charge is one charge.
 *
 * The phone sends `Idempotency-Key` (a uuid it minted when the golfer
 * tapped Pay) with a saved-card or wallet charge. The ledger row carries
 * it under a unique index per golfer (migration 047). A second request
 * with the same key, whether a retry after a lost answer or two taps that
 * raced, finds the first row and replays its outcome: a complete row
 * grants the bet (idempotent), a pending or unknown one is "check before
 * paying again", a failed one is the same refusal. Nothing goes to the
 * provider twice.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { grantBetForPayment } from '@/lib/claims/grant'
import { log } from '@/lib/observability/log'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

const KEY = /^[A-Za-z0-9_-]{8,64}$/

/** The key from the request, null when none was sent, or a 400 when it is malformed. */
export function readIdempotencyKey(request: Request): { key: string | null; response?: NextResponse } {
  const raw = request.headers.get('Idempotency-Key')
  if (raw === null) return { key: null }
  const key = raw.trim()
  if (!KEY.test(key)) {
    return { key: null, response: NextResponse.json({ error: 'Idempotency-Key must be 8 to 64 characters of letters, digits, - or _.', code: 'INVALID_INPUT' }, { status: 400 }) }
  }
  return { key }
}

export interface LedgerRow {
  m_payment_id: string
  status: string
  bet_id: string | null
}

/** The row a golfer's key already names, if any. */
export async function findByIdempotencyKey(admin: Admin, userId: string, key: string): Promise<LedgerRow | null> {
  const { data, error } = await admin.from('payfast_payments').select('m_payment_id, status, bet_id').eq('user_id', userId).eq('idempotency_key', key).maybeSingle()
  if (error) throw error
  return (data as LedgerRow | null) ?? null
}

/** Is this the unique index on (user_id, idempotency_key) complaining? */
export function isIdempotencyConflict(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && err.code === '23505' && /idempotency/i.test(err.message ?? '')
}

/**
 * Answer a repeat the way the first request was answered, from the ledger.
 * `declined` is the message for a failed row (the provider's reason is not
 * kept in a shape worth repeating).
 */
export async function replayCharge(admin: Admin, row: LedgerRow, opts: { userId: string; createdIpHash: string | null; declined: string }): Promise<NextResponse> {
  log.info('payments.charge.replayed', { user_id: opts.userId, m_payment_id: row.m_payment_id, status: row.status })
  if (row.status === 'complete') {
    const granted = await grantBetForPayment(admin, row.m_payment_id, { source: 'return', createdIpHash: opts.createdIpHash })
    if (!granted.ok) {
      return NextResponse.json({ error: 'Paid, but your shot could not be set up yet.', code: granted.reason, m_payment_id: row.m_payment_id, replayed: true }, { status: 409 })
    }
    return NextResponse.json({ betId: granted.betId, m_payment_id: row.m_payment_id, replayed: true })
  }
  if (row.status === 'failed') {
    return NextResponse.json({ error: opts.declined, code: 'CARD_DECLINED', replayed: true }, { status: 402 })
  }
  // pending, unknown, amount_mismatch: the money may have moved; the return
  // page settles it from the ledger and the provider's word.
  return NextResponse.json(
    { error: 'We could not confirm the charge. Check your shots in a minute before paying again.', code: 'CHARGE_UNKNOWN', m_payment_id: row.m_payment_id, replayed: true },
    { status: 409 },
  )
}
