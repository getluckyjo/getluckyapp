-- 022_free_swing_tier.sql
-- Adds the free swing ('tier_free') to the bet_tier enum: no stake, a
-- R10,000 prize, one per account. The freemium way in — a golfer plays the
-- whole thing once (shot, footage, claim, review) before spending anything.
--
-- Idempotent. Run outside a transaction (ALTER TYPE ... ADD VALUE), and
-- before 023, which uses the new value in an index predicate.
alter type public.bet_tier add value if not exists 'tier_free';
