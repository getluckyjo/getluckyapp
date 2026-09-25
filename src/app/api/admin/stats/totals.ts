/**
 * admin_totals() as the dashboard and the revenue report read it.
 *
 * Migration 032 corrected active_bets (only bets whose window is still
 * open) and added the keys below the line. src/lib/admin/data.ts's
 * adminTotals() maps only the older keys, so this reads the RPC itself.
 * A key the database does not send (032 has not run) is null, never 0, so
 * a screen can say "—" rather than a zero that is not true.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface Totals {
  /** Every stake taken: free, promo and golf day swings count as R0. */
  stakesCents: number
  /** Prizes recorded as paid. */
  prizesPaidCents: number
  totalBets: number
  activeBets: number
  /** Every open claim, whoever it is waiting on. */
  pendingClaims: number
  totalUsers: number
  // ── From migration 032; null before it runs ──
  expiredBets: number | null
  /** Documents in or under review: the admin's work. */
  claimsToReview: number | null
  /** Waiting on the golfer's documents. */
  claimsWaiting: number | null
  /** Verified, not yet paid. */
  prizesOwedCents: number | null
}

export async function readTotals(admin: SupabaseClient): Promise<Totals> {
  const { data, error } = await admin.rpc('admin_totals')
  if (error) throw error
  const t = (data ?? {}) as Record<string, unknown>
  const n = (k: string) => Number(t[k] ?? 0)
  const maybe = (k: string) => (t[k] == null ? null : Number(t[k]))
  return {
    stakesCents: n('total_revenue_cents'),
    prizesPaidCents: n('total_payout_cents'),
    totalBets: n('total_bets'),
    activeBets: n('active_bets'),
    pendingClaims: n('pending_claims'),
    totalUsers: n('total_users'),
    expiredBets: maybe('expired_bets'),
    claimsToReview: maybe('claims_to_review'),
    claimsWaiting: maybe('claims_waiting'),
    prizesOwedCents: maybe('prizes_owed_cents'),
  }
}
