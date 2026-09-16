/**
 * Turn a paid ledger row into a live bet.
 *
 * Two callers, one rule set:
 *   - the PayFast ITN, the moment it records a COMPLETE payment, so the bet
 *     exists whether or not the golfer's browser ever comes back with a
 *     session (an installed iOS app opens PayFast in an in-app browser that
 *     has no cookies; the return page there cannot finish anything);
 *   - /api/bets/create, when the return page does come back signed in, or
 *     when Home's "paid shot is waiting" card is tapped. It finds the bet the
 *     ITN made, or makes it if the ITN could not (age not yet verified).
 *
 * The ledger row is the only source of user, course, hole and tier: nothing
 * from a request body reaches the bet. One payment makes at most one bet:
 * the unique index on payment_intent_id resolves a race to the winner.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { BET_TIERS } from '@/lib/tiers'
import { verifyPaymentAmount } from '@/lib/payments'
import { computeExpiresAt } from '@/lib/claims/state-machine'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'

export type GrantResult =
  | { ok: true; betId: string; created: boolean }
  | { ok: false; reason: 'PAYMENT_PENDING' | 'PAYMENT_NOT_VERIFIED' | 'PAYMENT_UNMATCHED' | 'AGE_NOT_VERIFIED' | 'ACCOUNT_SUSPENDED' | 'INSERT_FAILED' }

interface GrantOptions {
  /** Who is asking, for the logs. */
  source: 'itn' | 'return'
  /** Hash of the caller's IP when a browser is asking; null from the ITN. */
  createdIpHash: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

export async function grantBetForPayment(admin: Admin, mPaymentId: string, opts: GrantOptions): Promise<GrantResult> {
  const { data: payment, error: payErr } = await admin
    .from('payfast_payments')
    .select('m_payment_id, pf_payment_id, user_id, course_id, hole_id, tier, amount_cents, status')
    .eq('m_payment_id', mPaymentId)
    .maybeSingle()
  if (payErr) throw payErr
  if (!payment) return { ok: false, reason: 'PAYMENT_PENDING' }
  if (payment.status !== 'complete' || !payment.user_id) return { ok: false, reason: 'PAYMENT_NOT_VERIFIED' }

  // Already granted? Our reference is never rewritten (migration 008).
  const { data: existing } = await admin.from('bets').select('id').eq('payment_intent_id', mPaymentId).maybeSingle()
  if (existing) return { ok: true, betId: existing.id, created: false }
  if (payment.pf_payment_id) {
    const { data: legacy } = await admin.from('bets').select('id').eq('pf_payment_id', payment.pf_payment_id).maybeSingle()
    if (legacy) return { ok: true, betId: legacy.id, created: false }
  }

  const amountCheck = verifyPaymentAmount(payment.tier ?? '', payment.amount_cents)
  const paidTier = BET_TIERS.find(t => t.tier === payment.tier)
  if (!amountCheck.ok || !paidTier) {
    log.warn('bets.grant.refused_tier_amount', { source: opts.source, m_payment_id: mPaymentId, tier: payment.tier, amount_cents: payment.amount_cents })
    return { ok: false, reason: 'PAYMENT_NOT_VERIFIED' }
  }
  if (!payment.course_id || !payment.hole_id) {
    await alertOps({ event: 'bets.grant.ledger_missing_target', path: 'bets_create', summary: 'A complete payment has no course/hole in its signed payload; no bet granted. Needs manual reconciliation.', details: { source: opts.source, user_id: payment.user_id, m_payment_id: mPaymentId } })
    return { ok: false, reason: 'PAYMENT_UNMATCHED' }
  }

  // The golfer's own gates: 18+ verified and not suspended. The ITN cannot
  // ask them anything, so it leaves the payment in the ledger and the return
  // page (or Home) tells them what is missing.
  const { data: profile } = await admin.from('profiles').select('age_verified_at, suspended_at').eq('id', payment.user_id).maybeSingle()
  if (profile?.suspended_at) return { ok: false, reason: 'ACCOUNT_SUSPENDED' }
  if (!profile?.age_verified_at) return { ok: false, reason: 'AGE_NOT_VERIFIED' }

  const { data: bet, error } = await admin
    .from('bets')
    .insert({
      created_ip_hash:     opts.createdIpHash,
      user_id:             payment.user_id,
      course_id:           payment.course_id,
      hole_id:             payment.hole_id,
      pf_payment_id:       payment.pf_payment_id ?? null,
      tier:                paidTier.tier,
      stake_pence:         paidTier.stakeZAR * 100,
      potential_win_pence: paidTier.winZAR   * 100,
      payment_intent_id:   mPaymentId,
      status:              'active',
      expires_at:          computeExpiresAt(),
      updated_by:          payment.user_id,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: duplicate } = await admin.from('bets').select('id').eq('payment_intent_id', mPaymentId).maybeSingle()
      if (duplicate) return { ok: true, betId: duplicate.id, created: false }
    }
    await alertOps({ event: 'bets.grant.insert_failed', path: 'bets_create', summary: 'A verified payment could not be turned into a bet.', details: { source: opts.source, user_id: payment.user_id, m_payment_id: mPaymentId, code: error.code, details: error.details }, err: error })
    return { ok: false, reason: 'INSERT_FAILED' }
  }

  // Link the ledger row to its bet and bump the attempt counter. Both
  // best-effort: the bet exists either way.
  const { error: linkErr } = await admin.from('payfast_payments').update({ bet_id: bet.id }).eq('m_payment_id', mPaymentId)
  if (linkErr) log.warn('bets.grant.ledger_link_failed', { bet_id: bet.id, m_payment_id: mPaymentId, error: linkErr.message })
  const { error: rpcErr } = await admin.rpc('increment_attempts', { user_id: payment.user_id })
  if (rpcErr) log.warn('bets.grant.attempt_counter_failed', { user_id: payment.user_id, error: rpcErr.message })

  log.info('bets.grant.created', { source: opts.source, user_id: payment.user_id, bet_id: bet.id, m_payment_id: mPaymentId, tier: paidTier.tier })
  return { ok: true, betId: bet.id, created: true }
}
