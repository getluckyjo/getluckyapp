/**
 * What a saved card may be charged for.
 *
 * A saved card is one tap with no 3-D Secure, so a hijacked session could
 * run it until the limiter stops it. Two bounds, both server-enforced and
 * mirrored on the stake screen so a golfer is offered the hosted checkout
 * (which has 3-D Secure) instead of an error:
 *
 *   - the stake: tiers above SAVED_CARD_MAX_STAKE_ZAR go through checkout;
 *   - the day: at most SAVED_CARD_DAILY_CAP_CENTS of saved-card charges per
 *     golfer in any rolling 24 hours, counting every charge that took or
 *     may have taken money (complete, pending, unknown).
 *
 * The constants and the pure check are importable from the client; the
 * ledger read is server-only (it takes the service-role client).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BetTierData } from '@/lib/tiers'

/** The biggest stake a saved card may be charged for, in rand. */
export const SAVED_CARD_MAX_STAKE_ZAR = 250
/** The most a golfer's saved card may be charged in any rolling 24 hours, in cents. */
export const SAVED_CARD_DAILY_CAP_CENTS = 250_000
/** The window the cap is measured over. */
export const SAVED_CARD_WINDOW_MS = 24 * 3_600_000

/** May this tier be paid with a saved card at all? */
export function savedCardAllowedForTier(tier: Pick<BetTierData, 'stakeZAR'> | undefined): boolean {
  return !!tier && tier.stakeZAR > 0 && tier.stakeZAR <= SAVED_CARD_MAX_STAKE_ZAR
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

/**
 * Cents a golfer's saved card has been charged (or may have been) in the
 * last 24 hours. A declined charge took nothing and is left out; a charge
 * with no answer yet counts, because it may have.
 */
export async function savedCardSpentCents(admin: Admin, userId: string, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - SAVED_CARD_WINDOW_MS).toISOString()
  const { data, error } = await admin
    .from('payfast_payments')
    .select('amount_cents')
    .eq('user_id', userId)
    .eq('raw_payload->>source', 'saved_card')
    .in('status', ['complete', 'pending', 'unknown'])
    .gte('created_at', since)
  if (error) throw error
  return ((data ?? []) as { amount_cents: number }[]).reduce((sum, r) => sum + (Number(r.amount_cents) || 0), 0)
}
