/**
 * Shared tier definitions — importable from both client and server code.
 * (BetContext.tsx re-exports these for backward compatibility.)
 *
 * Two families, deliberately kept apart:
 *
 *   BET_TIERS  the paid entries. Every payment route validates against this
 *              list, so nothing outside it can ever be sent to PayFast or
 *              accepted back from it.
 *   FREE_TIER  the free swing — one per account, no money, R10,000 prize.
 *              It is NOT in BET_TIERS: a R0 checkout is not a thing, and a
 *              free entry must never be reachable through the money path.
 *              /api/bets/free grants it directly.
 *   PROMO_TIER one extra free swing per promo code (migration 027). Same
 *              rules as FREE_TIER, granted by /api/bets/promo.
 *
 * Anything that merely *describes* a bet after the fact (admin labels, the
 * result screens) reads ALL_TIERS, because a free bet is a real bet.
 */

/** Tiers that are bought. */
export type PaidBetTier = 'tier_1' | 'tier_2' | 'tier_3' | 'tier_4' | 'tier_5' | 'tier_6'
/** Every tier a bet row can carry, free and promo included. */
export type BetTier = PaidBetTier | 'tier_free' | 'tier_promo'

export interface BetTierData {
  tier: BetTier
  stakeZAR: number
  winZAR: number
  /** Prize ÷ stake. Zero for the free and promo swings, which have no stake to multiply. */
  multiplier: number
  label: string
}

export const BET_TIERS: BetTierData[] = [
  { tier: 'tier_1', stakeZAR: 50,   winZAR: 25000,   multiplier: 500,  label: 'R50 → R25,000'       },
  { tier: 'tier_2', stakeZAR: 100,  winZAR: 60000,   multiplier: 600,  label: 'R100 → R60,000'      },
  { tier: 'tier_6', stakeZAR: 150,  winZAR: 100000,  multiplier: 667,  label: 'R150 → R100,000'     },
  { tier: 'tier_3', stakeZAR: 250,  winZAR: 200000,  multiplier: 800,  label: 'R250 → R200,000'     },
  { tier: 'tier_4', stakeZAR: 500,  winZAR: 500000,  multiplier: 1000, label: 'R500 → R500,000'     },
  { tier: 'tier_5', stakeZAR: 1000, winZAR: 1000000, multiplier: 1000, label: 'R1,000 → R1,000,000' },
]

/**
 * The free swing: the freemium way in. No stake, a real R10,000 prize, and
 * the same shot, footage, claim and review as any paid entry — so a golfer
 * can try the whole thing once before spending anything.
 */
export const FREE_TIER: BetTierData = {
  tier: 'tier_free', stakeZAR: 0, winZAR: 10000, multiplier: 0, label: 'Free swing → R10,000',
}

/** How many free swings an account ever gets. */
export const FREE_SWINGS_PER_ACCOUNT = 1

/**
 * The promo swing: one extra free swing, granted by a promo code made at
 * /admin/promos. The free swing's prize and the free swing's rules; its own
 * tier so the one-per-account limit on the free swing (migration 023) is
 * not touched by it. Each code is good for one per golfer, up to its cap
 * and until its date (migration 027).
 */
export const PROMO_TIER: BetTierData = {
  tier: 'tier_promo', stakeZAR: 0, winZAR: 10000, multiplier: 0, label: 'Promo swing → R10,000',
}

/** Paid tiers plus the free and promo ones — every tier a bet row can carry. */
export const ALL_TIERS: BetTierData[] = [...BET_TIERS, FREE_TIER, PROMO_TIER]

/** Look a tier up by key, free included. Undefined for a key we do not know. */
export function tierByKey(tier: string | null | undefined): BetTierData | undefined {
  return ALL_TIERS.find(t => t.tier === tier)
}

/** Is this the free swing? */
export function isFreeTier(tier: string | null | undefined): boolean {
  return tier === FREE_TIER.tier
}

/** Is this a promo swing? */
export function isPromoTier(tier: string | null | undefined): boolean {
  return tier === PROMO_TIER.tier
}

/** Was this entry played without a stake (free or promo swing)? */
export function isNoStakeTier(tier: string | null | undefined): boolean {
  return isFreeTier(tier) || isPromoTier(tier)
}

// ── Derived maps for admin / API use ──

/** Map of tier key → display label */
export const TIER_LABELS: Record<BetTier, string> = Object.fromEntries(
  ALL_TIERS.map(t => [t.tier, t.label]),
) as Record<BetTier, string>

/** Map of tier key → stake in ZAR cents */
export const TIER_STAKE_CENTS: Record<BetTier, number> = Object.fromEntries(
  ALL_TIERS.map(t => [t.tier, t.stakeZAR * 100]),
) as Record<BetTier, number>

/** Map of tier key → potential win in ZAR cents */
export const TIER_WIN_CENTS: Record<BetTier, number> = Object.fromEntries(
  ALL_TIERS.map(t => [t.tier, t.winZAR * 100]),
) as Record<BetTier, number>
