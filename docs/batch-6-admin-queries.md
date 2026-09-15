# Batch 6 — Admin correctness and query performance

Closes AUDIT.md D.1 (N+1, full-table reduces, wrong pagination totals,
missing indexes) and the admin gaps noted along the way: admins could not
see who a user is, and there was no button to record a payout.

## What changed

**Admins can see emails.** Migration 010 adds `profiles.email`, backfilled
from `auth.users` and kept in sync by the signup trigger and a new trigger on
email change. It is server-owned (the profile guard now rejects client
writes to it). The user list, user detail and users export show it.

**Filters are in the query, so totals and pages are right.**
- User search (name or email) is a SQL `ilike` filter.
- Bet search resolves the term to matching player ids, course ids and a
  bet id, then filters the bets query on those. Delimiter characters are
  stripped from the term so it cannot break the filter grammar.
- Verification queue tier filter and "highest value" sort resolve the
  ordered set of claimed bets first and page over their verifications in
  that order. Exact counts on every page.

**Aggregates in SQL.** `admin_totals()`, `admin_revenue_by_tier()` and
`admin_revenue_by_course()` (service role only) replace the two handlers
that loaded every bet into memory. The dashboard and the revenue report call
them.

**Indexes**: `bets(created_at desc)`, `bets(user_id, created_at desc)`,
`bets(status, created_at desc)`, `verifications(created_at)`,
`holes(course_id)`, `profiles(lower(email))`.

**Payout confirmation button.** On an approved claim whose bet is
`verified`, the admin detail page shows "Confirm Payout Made" with a
confirmation modal; it calls the existing payout transition, which records
the admin in the audit trail and puts the winner on the public list.
Once paid it shows "Prize paid".

**Tests**: 253. New cases for search by name and email with exact totals,
bet search by player, course and id (and delimiter injection), tier and
highest-value pagination, and the aggregates.

## Proving the improvement

`scripts/staging/explain.mjs` runs `EXPLAIN ANALYZE` on the ten reads that
matter (admin lists, player history, queue, holes, email search, the three
aggregates, and the old "load every bet" query for comparison) and prints
execution time, rows and which index each used.

Run it against staging **before** applying migration 010, apply, run it
**again**, and paste both tables below. On the seeded staging data (≈60
bets) everything is sub-millisecond either way; the point is the `access`
column changing from `SeqScan bets` to `Index Scan bets_created_at_idx`,
which is what holds at 100× the volume. For a meaningful timing delta,
seed a larger set first: `npm run staging:seed` is repeatable, and the
seed script accepts `STAGING_SEED_BETS_PER_USER=50` to inflate it.

```
Before (paste output)

After (paste output)
```

## Apply order

Migration 010 first, then deploy.

1. Run `supabase/migrations/010_admin_queries.sql`. The final SELECTs show
   the totals and `profiles_without_email` (should be 0 unless some auth
   users have no email, e.g. phone sign-ups, which this app does not have).
2. Merge and deploy.

## What to test on the preview URL

1. `/admin/users`: emails are visible; searching `golfer03` returns exactly
   that user with total 1; page counts match.
2. `/admin/bets`: search a golfer's name, a course name, and paste a bet id.
   The total reflects only matches.
3. `/admin/verification-queue`: filter by tier and sort by highest value with
   the page size at its smallest; page through; totals stay exact.
4. `/admin` dashboard and `/admin/reports` load and agree with a manual SQL
   sum of `stake_pence`.
5. Approve a claim, then "Confirm Payout Made": the bet shows paid, the audit
   trail has your admin id on the `verified → paid` row, `/leaderboard` shows
   the winner.
6. In the SQL editor as a normal user (browser console with the anon key),
   `update profiles set email = 'x' where id = <own id>` → error 42501.

## Risk that remains

- **Bet search caps at 100 matching players and 50 courses.** A term that
  matches more than that (e.g. searching `a`) returns bets for the first
  100 players only. Fine for an operator; a real search box would want a
  minimum term length in the UI.
- **The claimed-bets resolution for the queue is capped at 5,000.** The
  queue only ever holds bets that reached a claim, so this is years away.
- **`profiles.email` is a mirror**, not the source of truth. If someone
  changes their email through Supabase without the trigger firing (a manual
  dashboard edit to `auth.users`), the mirror lags until the next trigger
  event. The backfill statement in 010 can be re-run at any time.
- **Timings are not in this document yet.** They need the staging database,
  which this environment cannot reach; the script and the procedure above
  are the deliverable until you paste the two tables.
