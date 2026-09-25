# Promo codes

A promo code gives a golfer one extra free swing. An admin makes the code
at `/admin/promos` with a limit on its total uses and a last day. A golfer
types it under "Have a promo code?" on the stake screen and plays one more
free swing: no stake, the free swing's R10,000 prize, then the usual
record → claim → review path.

Each code works once per golfer. It is on top of the free swing every
account already gets, and a golfer with two codes gets two swings.

## Going live

1. In the Supabase SQL editor, run `supabase/migrations/026_promo_swing_tier.sql`
   **on its own** (it adds a value to the `bet_tier` enum, and Postgres
   will not use a new value in the same transaction that added it).
2. Then run `supabase/migrations/027_promo_codes.sql`. Its last three
   selects should show the table, the index and the trigger, an empty
   usage list, and the free swing report as before.
3. Deploy the code. The order matters: the stake screen and
   `/api/bets/promo` need both migrations in place first.
4. `supabase/check-migrations.sql` now lists 022 to 027 as well.

Both migrations are safe to run again.

## Using it

- **Make a code.** `/admin/promos` → type a code (capitals, digits and
  dashes, 4 to 40 of them) or leave it blank for an eight-character one,
  set the total uses and the last day, add a note saying where it is going.
  A code works to the end of its last day, South African time.
- **Change it.** The pencil changes the limit or the date. Raising either
  reopens a code that ran out; lowering the limit below the uses already
  taken closes it, and nobody who has played loses their swing.
- **Stop it.** The power button switches a code off at once and back on
  again. A code nobody has played can be deleted; one that has been played
  stays on record, because the bets point at it.
- **Watch it.** Each row shows uses out of the limit, how many of those
  swings became a claim, and how many of those golfers have staked real
  money since. Give each campaign its own code and this table tells you
  which one worked.

## How it holds

The rules are in the database, so the route's own checks are only there to
give the golfer a friendly answer:

| Rule | Held by |
|---|---|
| One use of a code per golfer | Unique index on `bets (promo_code_id, user_id)`, plus the `promo_<code>_<user>` reference on the existing unique `payment_intent_id` |
| Never more than the limit, even when two golfers take the last use at once | `BEFORE INSERT` trigger on `bets` that locks the code row, then counts |
| Expired or switched-off codes give nothing | The same trigger |
| A promo swing always names its code, and nothing else does | Check constraint `bets_promo_code_matches_tier` |
| Never bought, refunded or matched to a payment | `tier_promo` is not in `BET_TIERS`, which every payment route validates against |

Playing the code *is* redeeming it: the swing is granted against the hole
already chosen, so there is no credit on an account to lose or reconcile,
and the bet row is the record of the use.

The free swing report (Reports → Free Swings) used to count every bet that
was not a free swing as a paid one. Migration 027 changes it to count only
bets with a stake, so promo swings do not inflate its conversion numbers.

## Testing it

`__tests__/money/promo-swing.test.ts` covers the rules, both routes, the
admin routes and the report. The race for the last use and the double tap
are both staged there (`db.beforeInsert` in the test fake).

The migrations were also applied to a local Postgres 16 with every earlier
migration, and the trigger was exercised directly: one use per golfer,
the limit, expiry, off switch, the check constraint, deleting a used code,
and two sessions racing for the last use (the second waited for the first
to commit, then was refused).

By hand on a preview:

1. Make a code with a limit of 2 at `/admin/promos`.
2. As golfer A: pick a hole, "Have a promo code?", type it in lower case.
   The card appears and the sheet opens; play it, and the record screen
   opens as for any entry.
3. As A again: the same code says you have already played it.
4. As golfer B: it works. As golfer C: "Every swing on that code has been
   taken." The admin row shows 2 of 2, Used up.
5. Switch the code off, raise the limit to 3: C still cannot play it.
   Switch it on: C can.

## Before handing codes out

- **Insurance.** Every promo swing is a real R10,000 prize with no stake
  behind it. Confirm with Indwe that promo entries are covered, and what
  each one costs to cover.
- **Second accounts.** An account is an email address. One use per golfer
  means one per account, so someone with a second email address can use a
  code twice. The limit on each code is what bounds the exposure; keep
  limits small and dates short. The IP and device risk rules flag repeat
  accounts when a claim comes in, not when a code is played.
- **Terms.** `/terms` describes the paid entries only, and says nothing
  about the free swing or promo codes. Prizes won on a free entry may count
  as a promotional competition under the Consumer Protection Act. Get a
  legal read before codes go out in public.
