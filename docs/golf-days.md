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
| Tab | "BS", with the bomb and BS shield from the can as its icon. Migration 029 seeds the label "Bomb Squad", which a narrow phone cuts to "BOMB SQ…"; production's is changed to "BS" in the admin |
| Look | The can: white stock, bottle-green line work, gold accent. Photo brightened in `public/golf-days/bombsquad/hero.jpg`. The label says "Free swing" and names the venue "Royal Johannesburg" (the theme's `venue`), without "& Kensington" |

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
tees Championship, Club, Executive and Classic. The challenge on East 16
is played from the Club tee, 152 m (Johannes, 25 September 2026). From the
Executive tee it would be 127 m, under the app's 140 m minimum.

Migration 029 also corrects the West course's par 3 distances to the
club's 2024 card (yellow tees). They were out of date from migration 019.

### Message to send with the link

One link does it: joining leads straight into putting the app on the home
screen (see "Home screen" below). For WhatsApp, paste as is; the asterisks
are WhatsApp's bold.

```
*Bomb Squad Golf Day × Get Lucky* ⛳

Every player gets ONE free swing for *R100 000* on Friday 2 October. Hole it and it's yours.

*Before Friday (takes 2 minutes):*
Tap the link, sign in and tap *Join*. Then add Get Lucky to your home screen when it asks.
https://www.getluckyholeinone.com/golf-day/bombsquad

*On the day:*
At *East 16* or *West 17*, open the *BS* tab and tap your hole. Hand your phone to a playing partner to film your tee shot. That's it.

18+ only. One swing each.

See you on the tee. Time to get lucky! 🍀
```

### Home screen

Joining is the moment to put the app on the phone, so it follows straight
on:

- **Android, Chrome:** tapping Join opens Chrome's own install dialog.
  Chrome only allows it straight after a tap, and only once it has decided
  the site can be installed. When it can't, the pop-up below opens instead.
- **Everywhere else:** a "You're in. One more step" pop-up with the taps
  for that phone. iPhone Safari gets Share → Add to Home Screen. An iPhone
  in WhatsApp, Chrome or Instagram is told to open the page in Safari
  first, with a Copy link button. Android without the dialog gets the
  three-dot menu route, plus how to leave WhatsApp's browser.
- **Joined on the way back from signing in:** no tap, so always the pop-up.
- **Later:** "Put Get Lucky on your home screen" under their status reopens
  it. Nothing is offered once the app is installed, or on a computer.

On iPhone the home screen app keeps its own sign-in, separate from
Safari's. The pop-up tells players to sign in once more with the code from
their email. Their join is on their account, so the tab is there when they
do.

### Calendar

Once joined, "Add to my calendar" sits under the player's status until the
day. It puts an all-day event on the golf day in their own calendar, with
the holes, the tab to open, the link, and a reminder at 07:00. That way the
link can't get lost in WhatsApp. On iPhone and on a computer it opens
`/api/golf-days/<slug>/calendar`, an .ics file that Safari adds in one tap.
On Android it opens Google Calendar's add page, which opens the Calendar
app. The event is built in `src/lib/golf-days/calendar.ts`.

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
