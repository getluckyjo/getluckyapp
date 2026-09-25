# Golf days

When Get Lucky sponsors a golf day, every player gets one free swing at the
prize on the day. Each golf day has its own link,
`getluckyholeinone.com/golf-day/<slug>`. A player opens it, signs in, and
taps Join. From then on their Icons tab is the golf day's tab. On the day
they tap the hole they are standing on, a playing partner films the shot,
and it goes through the usual claim and review.

Nobody else sees any of it. Anyone who has not joined, signed out included,
keeps the Icons tab. The golf day screen is not linked from anywhere else
in the app.

Set one up with the `golf-day` skill (`.claude/skills/golf-day/SKILL.md`),
or by hand at `/admin/golf-days`.

## The Bomb Squad Golf Day

| | |
|---|---|
| Link | `https://www.getluckyholeinone.com/golf-day/bombsquad` |
| Date | Friday 2 October 2026 (the swing works 00:00–23:59, South African time) |
| Venue | Royal Johannesburg & Kensington, East and West courses |
| Holes | East 16, 152 m from the club tees; West 17, 161 m from the white tees (where golf days play it) |
| Prize | R100 000, covered by Get Lucky (not insured by Indwe) |
| Places | 200 |
| Tab | "Bomb Squad" |
| Look | The can: white stock, bottle-green line work, gold accent. Photo brightened in `public/golf-days/bombsquad/hero.jpg` |

Each course's signature par 3, with lengths from the club's own 2024
scorecards:

- **East 16** (152 m from the club tees) plays over water. The club has
  recently reworked it as a showpiece, and SA Top 100 reviewers pair it
  with the 5th as "the par 3s over water".
- **West 17** is the West's most celebrated par 3, "one of the best par 3s
  in South Africa". It plays from an elevated tee to a green that falls
  away on the right, and is 185 m from the yellow tees or 161 m from the
  white.

Golf days at Royal normally play the white tees, so production has West
17 at 161 m (set by hand on 25 September 2026). Migration 029 on its own
leaves it at 185 m from the yellow tees. The East's scorecard names its
tees Championship, Club, Executive and Classic, and East 16 is shown from
the Club tee (152 m). From the Executive tee it is 127 m, under the app's
140 m minimum.

Migration 029 also corrects the West course's par 3 distances to the
club's 2024 card (yellow tees). They were out of date from migration 019.

### Message to send with the link

> **Bomb Squad Golf Day × Get Lucky: one free swing each for R100 000**
>
> 1. **Before Friday:** open www.getluckyholeinone.com/golf-day/bombsquad on your phone. Sign in with Google or your email, confirm you're 18 or older, and tap **Join**. A **Bomb Squad** tab appears at the bottom of the app. Tip: add the page to your home screen.
> 2. **On the day:** at East hole 16 or West hole 17, open the **Bomb Squad** tab and tap the hole you're on.
> 3. **Film it:** hand your phone to a playing partner to film your tee shot in the app.
>
> Hole it, and once the club and your playing partners confirm it, R100 000 is yours.

## Going live

1. **Database.** In the Supabase SQL editor, run `028_golf_day_tier.sql`
   **on its own**, then `029_golf_days.sql`. The last select in 029 should
   list the Bomb Squad day with East 16 (152 m) and West 17 (185 m): both
   par 3, active and at partner courses.
2. **Deploy.** Merge the pull request.
3. **Sign-ups.** Raise Supabase's email rate limit before the link goes
   out (Authentication → Rate Limits). The default of 30 an hour will stall
   200 players signing up in one evening. Ask players to sign up before
   the day, not at registration: 200 people on one clubhouse Wi-Fi at once
   is the busiest moment the app could have.
4. **Claims.** A claim asks the club to confirm by email. Johannes is the
   club official for Royal Johannesburg East and West (Admin → Courses →
   Contacts, 25 September 2026). Every claim at either course, golf day or
   paid, emails him.
5. **Terms.** `/terms` says every prize is insured by Indwe. The golf day
   screen says the prize is paid by Get Lucky. Johannes chose to leave the
   terms as they are (25 September 2026).
6. **Dry run.** At `/admin/golf-days`, make a test golf day with today's
   date and one hole. Open its link on two phones, join, take a swing, film
   it and declare a miss. Then switch it off.

## On the day

`/admin/golf-days` → the Bomb Squad row shows how many have joined out of
200, swings taken, and claims. The players button lists everyone who joined
and where each swing stands: not taken, started, missed or claimed. A claim
also lands in the Verification Queue like any other.

If something goes wrong, the power button switches the golf day off. Its
tab disappears and no one can start a swing until you switch it back on.
Swings already started are not affected.

## How it holds

| Rule | Held by |
|---|---|
| Never more players than the day takes, even when two players race for the last place | Trigger on `golf_day_players` that locks the golf day, then counts |
| No joining after the day | Same trigger |
| One swing per player | Unique index on `bets (golf_day_id, user_id)`, plus the `golfday_<day>_<user>` reference on the unique `payment_intent_id` |
| Only a joined player, only on the day (South African time), only on the day's holes, only for the day's prize | Trigger on `bets` |
| A golf day swing names its golf day, and nothing else does | Check constraint `bets_golf_day_matches_tier` |
| Never bought or matched to a payment | `tier_golf_day` is not in `BET_TIERS` |
| The hole is a real, active, partner par 3 of 140 m or more | Checked when the golf day is saved, and again by the swing (`checkTarget`) |

A player who signs in from the link comes back to it afterwards, including
a first-timer sent through the 18+ check (`safeNext` accepts
`/golf-day/<slug>`, and `/age-check` honours it). A player who tapped
"Sign in to join" is joined automatically on the way back.

The golf day tab stays for a week after the day, while any claim is in
hand. Then Icons comes back.

## Testing

`__tests__/money/golf-day.test.ts` covers the day's time window, the
routes, the tab, the admin and both races, staged through the test fake.
`__tests__/money/auth-flow.test.ts` covers the way back from sign-in.

Migrations 001–029 were applied to a local Postgres 16. Every trigger rule
was exercised there: full, over, not joined, wrong hole, wrong prize, not
yet, one swing, switched off, and deleting a golf day that has swings. So
was a race of two sessions for the last place. The screen was checked in a
browser at phone width, signed out, joined before the day, and on the day
with the confirm sheet open.
