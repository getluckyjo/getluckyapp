-- 023_free_swing_limit.sql
-- One free swing per account, enforced by the database rather than by the
-- route that hands it out. /api/bets/free also writes a deterministic
-- payment_intent_id ('free_<user id>'), which the existing unique index on
-- that column already catches; this index is the direct statement of the
-- rule, and holds even if that reference scheme ever changes.
--
-- Must run after 022: the predicate uses the new enum value, which Postgres
-- refuses to read in the same transaction that added it.
create unique index if not exists bets_one_free_swing_per_user
  on public.bets (user_id)
  where tier = 'tier_free';

comment on index public.bets_one_free_swing_per_user is
  'The free swing is once per account, for life. Lifting this makes free R10,000 prizes farmable by signing up again.';
