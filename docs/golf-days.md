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

A **golf trip** is a golf day over several days (migration 033): one
link for a whole tour, a free swing for every player in every round, each
on that round's hole, and a prize that can be in dollars. See "Golf trips"
below.

Set one up at `/admin/golf-days` (see "Adding a golf day" below), or ask
Claude with the `golf-day` skill (`.claude/skills/golf-day/SKILL.md`),
which also researches the holes.

## Adding a golf day

Everything is in `/admin/golf-days` → **New golf day**. No code, no deploy:

1. **The facts:** the link (it can't change once sent), name, tab label
   (7 characters fits best), date, prize, places, and the holes (course,
   then hole; only par 3s of 140 m or more are offered).
2. **The look:** upload the host's logo or a photo. It is resized and
   stored, shown whole if it has a see-through background (a logo) or
   filling the top if not (a photo), and colours are suggested from it.
   Set the host ("Host × Get Lucky"), the venue as players know it, the
   line under the prize, and for an alcohol brand the 18+ line (one
   click). The preview beside the form is the player's screen itself, and
   warns when the ink is hard to read on the card.
3. **Save.** The row shows the link to copy, and warns about anything
   still to do: a course with no club official to confirm a claim, a tab
   label too long for small phones.
4. **The message:** the speech-bubble button gives the WhatsApp message
   for players, ready to copy, with the link, date, holes and tab filled
   in. Change anything before copying it.

Only a drawn tab icon, like Bomb Squad's bomb, needs code
(`GOLF_DAY_ICONS` in `src/components/layout/BottomTabBar.tsx`); any
other golf day's tab shows a flag.

## Golf trips

A golf day with a **Last day** is a trip. Same form, three differences:

- **Dates.** "First day" and "Last day" (at most 30 days apart). Joining
  stays open until the last day ends, South African time, and the tab
  stays a week after it.
- **A hole per round, each with its date.** Every hole gets the date of
  the round it is played in (the picker beside each hole). A player's
  swing on a hole opens on that date only, and each hole takes one swing
  each. A day on two courses (Royal Cape in the morning, Steenberg in the
  afternoon) is two holes on the same date: two swings that day.
- **The prize's currency.** R or $. A dollar prize is shown as "$5,000"
  everywhere a player or the admin sees it, and the swing carries it
  (`bets.prize_currency`). It is never added to rand: the dashboard and
  reports give rand totals with "Plus $… on golf trips" beside them, the
  history and winners show each prize in its own currency, and the
  exports have a Prize Currency column. A dollar prize is at most $50 000.

The player's screen lists the rounds by date. On a round day it shows
that day's hole (two on a two-course day) to tap, then "Today's swing is
in" with the next round's date and hole; each hole in the list says how
its swing went. The calendar event spans the trip and lists every round.
The WhatsApp message lists the rounds too.

Once a swing has been taken, a golf day cannot become a trip or a trip a
golf day: the one-swing rule counts them differently. The dates and holes
can still change; a swing already taken keeps its prize.

## The Bomb Squad Golf Day

| | |
|---|---|
| Link | `https://www.getluckyholeinone.com/golf-day/bombsquad` |
| Date | Friday 2 October 2026 (the swing works 00:00–23:59, South African time) |
| Venue | Royal Johannesburg & Kensington, East and West courses |
| Holes | East 16, 152 m from the club tees; West 17, 161 m from the white tees (where golf days play it) |
| Prize | R100 000, covered by Get Lucky (not insured by Indwe) |
| Places | 200 |
| Tab | "BS", with the bomb and BS shield from the can as its icon. Migration 029 seeded the label "Bomb Squad", which a narrow phone cuts to "BOMB SQ…"; migration 030 changes it to "BS" |
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

The admin's message button gives this (asterisks are WhatsApp's bold):

```
⛳ *Bomb Squad Golf Day × Get Lucky* 🍀

One free swing. One hole. *R100 000* if it drops on *Friday 2 October*. 💰

📲 *Before Friday:* tap the link, sign in, hit *Join*, then add it to your home screen and calendar.
https://www.getluckyholeinone.com/golf-day/bombsquad

🏌️ *On the day:* at *East 16* or *West 17*, open the *BS* tab, tap your hole and get a mate to film it.

18+. One swing each. Swing like the rent's due. 🍀
```

## The SaSwazi Golf Trek

| | |
|---|---|
| Link | `https://www.getluckyholeinone.com/golf-day/saswazi` |
| Date | Friday 2 October 2026 (the same day as Bomb Squad; the swing works 00:00–23:59, South African time) |
| Venue | Umdoni Park Golf Club, Pennington, KZN South Coast. One course |
| Hole | 16, 185 m from the white (back) tees, about 178 m from the blue |
| Prize | R100 000, covered by Get Lucky (not insured by Indwe) |
| Places | 24 |
| Tab | "SaSwazi", with the pin flag: the logo is a scene, not a mark that reads at tab size |
| Look | The trek's sticker logo, shown whole above the label (`hero.kind: 'logo'`), in its colours: cream stock, bottle green, hot pink. The label names the venue "Umdoni Park" |

Umdoni Park has four par 3s: 3 (116 m), 7 (155 m), 12, "Majuba" (110 m),
and 16 (185 m), from the white tees. 3 and 12 are under the app's 140 m
minimum. Johannes chose the 16th (25 September 2026): Umdoni's signature
par 3, which "plummets steeply downhill" from an elevated tee (SA Top 100),
so it plays shorter than its length. The 7th was the alternative nearest
150 m. Distances are from the club's card as published by GolfPass
(Black 170 and 202 yd, Red 148 and 195 yd for 7 and 16); its totals match
SA Top 100's White 5 592 m and Blue 4 989 m.

Migration 030 seeds it, and checks the hole. The admin's message:

```
⛳ *SaSwazi Golf Trek × Get Lucky* 🍀

One free swing. One hole. *R100 000* if it drops on *Friday 2 October*. 💰

📲 *Before Friday:* tap the link, sign in, hit *Join*, then add it to your home screen and calendar.
https://www.getluckyholeinone.com/golf-day/saswazi

🏌️ *On the day:* at Umdoni Park's *16th*, open the *SaSwazi* tab, tap the hole and get a mate to film it.

18+. One swing each. Swing like the rent's due. 🍀
```

## The Random Golf Club South Africa trip

Offered to Random Golf Club (randomgolfclub.com, a US golf travel club)
for its South Africa trip: everyone who signs up gets a free swing on the
signature par 3 of every course, and a hole-in-one on any of them wins
**$5,000**, captured in the app. Insured through Indwe and Santam: cover
to be confirmed before the link goes out.

| | |
|---|---|
| Link | `https://www.getluckyholeinone.com/golf-day/rgc-sa` (proposed; agree it before it is sent: it cannot change) |
| Dates | Sunday 14 to Saturday 20 February 2027 (the trip is 14–21; the 21st is the flight home) |
| Prize | $5,000 (USD), every player, any round |
| Places | 28: 24 golfers and a few spare |
| Tab | "RGC" |
| Look | Host "Random Golf Club", venue "Cape Town", RGC's logo uploaded in the admin |

The holes, one a course, each a signature par 3 near 150 m, chosen from
the clubs' own cards in October 2026 (migration 034 corrects the app's
par 3s for these courses):

| Round | Course | Hole | Tee | m | Why | Alternative |
|---|---|---|---|---|---|---|
| Sun 14 Feb | Metropolitan | 6 "Thermopylae" | White | 152 | Nearest 150 on the front nine, which the arrival nine plays | 18 "The Breakwater", 148 m, over the dam to the green under the clubhouse, if the nine played is the back routing |
| Mon 15 Feb | Royal Cape | 15 | Yellow | 148 | "A finely judged shot over the water which encroaches right up to the edge of the green" | 13, 165 m yellow |
| Mon 15 Feb | Steenberg | 7 | Yellow | 148 | The island green, "Steenberg's signature hole" (the club). The club lists 140 m from the white tees | 14, the club's featured hole: 166 m white |
| Tue 16 Feb | Arabella | 5 | Yellow | 153 | Ends the "Arabella Turn" of signature holes (147 m from the white) | 17 along the lagoon, 167 m yellow |
| Wed 17 Feb | Stellenbosch | 9 | Yellow | 148 | Uphill, all carry | The famous downhill 7th is 139 m yellow, under the 140 m minimum |
| Thu 18 Feb | Clovelly | 16 | White | 148 | Nearest 150; Clovelly's signature is a par 5 | 8, the longest, 156 m white |
| Fri 19 Feb | Pearl Valley | 3 "Ace" | White | 145 | Water carry; the club says it has the most recorded holes-in-one (tell Indwe) | 13, the club's signature hole, 140 m white / 160 m yellow |
| Sat 20 Feb | De Zalze | 9 | Yellow | 146 | Elevated tee over a dam | 3, 145 m white / 159 m yellow |

Eight swings a golfer, 192 for 24 golfers. At the usual 1 in 12,500 for
an amateur's swing at a par 3, about a 1.5% chance that someone wins.

Before the link goes out:

1. Migrations 033 and 034 (Going live, below), then deploy.
2. Indwe's cover confirmed. Then the small print can say so (the look's
   footnote), and `/terms` may need a line for a dollar prize; Johannes
   decides.
3. RGC confirms which nine Metropolitan plays, and the tees: the app
   keeps one distance a hole, from the tee above. A different tee changes
   that hole in Admin → Courses.
4. A club official for each of the eight courses (Admin → Courses →
   Contacts); the admin row warns until they are in.
5. Make it in `/admin/golf-days` with the values above, then copy the
   message from the speech-bubble button.

## Every golf day

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

### Add to calendar

Once joined, and until the day, the screen has an **Add to calendar**
button, so the link is easy to find again. The event is all day on the
golf day's date, with the holes, the tab to open and the link
(`src/lib/golf-days/calendar.ts`):

- **iPhone and computers:** the button opens `GET /api/golf-days/<slug>/calendar`,
  an .ics file. Safari shows it as an event to add; a computer downloads
  it. It carries a reminder at 7am on the day. From the installed app it
  opens over the app.
- **Android:** the button opens Google Calendar with the event filled in.
  Google ignores reminders in a link, so the phone's default one applies.

Every download has the same event ID, so adding it twice updates the
event rather than repeating it. A switched-off golf day has no calendar
file. Wallet passes were considered and left: Apple Wallet needs an Apple
Developer account and a signing certificate, Google Wallet an approved
issuer account.

## Going live

1. **Database.** In the Supabase SQL editor, run `028_golf_day_tier.sql`
   **on its own**, then `029_golf_days.sql`. The last select in 029 should
   list the Bomb Squad day with East 16 (152 m) and West 17 (185 m): both
   par 3, active and at partner courses. Then `030_saswazi_golf_trek.sql`:
   its select should list SaSwazi with Umdoni Park 16 (185 m), and Bomb
   Squad with the tab label BS. Then `031_golf_day_looks.sql`, before the
   admin can save a look: it adds `golf_days.look`, the public
   `golf-day-art` bucket, and copies Bomb Squad's and SaSwazi's looks
   onto their rows. Then `033_golf_day_trips.sql` **before deploying**
   the trips code (the history and the admin read `bets.prize_currency`):
   its select lists every golf day as a day, in rand, with every swing
   already taken in the slot `day`. Then `034_cape_town_par_3s.sql`: its
   select lists the eight Cape Town courses' par 3s (Royal Cape 15 at
   148 m, Steenberg 2/7/14/17 on and 3/6/11 off, Stellenbosch 7/9/13/15
   on and 4/12 off, Metropolitan with four).
2. **Deploy.** Merge the pull request.
3. **Sign-ups.** Raise Supabase's email rate limit before the link goes
   out (Authentication → Rate Limits). The default of 30 an hour will stall
   200 players signing up in one evening. Ask players to sign up before
   the day, not at registration: 200 people on one clubhouse Wi-Fi at once
   is the busiest moment the app could have.
4. **Claims.** A claim asks the club to confirm by email. Johannes is the
   club official for Royal Johannesburg East and West (Admin → Courses →
   Contacts, 25 September 2026). Every claim at either course, golf day or
   paid, emails him. Umdoni Park needs its own official before the
   SaSwazi Golf Trek (Admin → Courses → Umdoni Park Golf Club → Contacts).
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
| No joining after the day (a trip's last day) | Same trigger |
| One swing per player; on a trip, one per player per hole | Unique index on `bets (golf_day_id, user_id, golf_day_slot)`, the slot set by the swing trigger (`day`, or the hole on a trip), plus the `golfday_<day>_<user>` reference (`…_<hole>` on a trip) on the unique `payment_intent_id` |
| Only a joined player, only on the day or the trip's days (South African time), only on its holes, a trip's hole only on its round's date, only for its prize in its currency | Trigger on `bets` |
| A prize in dollars only on a golf day swing | Check constraint `bets_prize_currency_check` |
| A golf day swing names its golf day, and nothing else does | Check constraint `bets_golf_day_matches_tier` |
| Never bought or matched to a payment | `tier_golf_day` is not in `BET_TIERS` |
| The hole is a real, active, partner par 3 of 140 m or more | Checked when the golf day is saved, and again by the swing (`checkTarget`) |

A player who signs in from the link comes back to it afterwards, including
a first-timer sent through the 18+ check (`safeNext` accepts
`/golf-day/<slug>`, and `/age-check` honours it). A player who tapped
"Sign in to join" is joined automatically on the way back.

The golf day tab stays for a week after the day (a trip's last day),
while any claim is in hand. Then Icons comes back.

## Testing

`__tests__/money/golf-day.test.ts` covers the day's time window, the
routes, the tab, the admin and both races, staged through the test fake.
Its last block covers trips: the window over several days, a swing a
round (two on a two-course day), a hole only on its round's date, the
dollar prize, the race on one hole, the admin's dates and the rule that
a golf day with swings stays what it is, and the trip's calendar event
and message.
`__tests__/money/auth-flow.test.ts` covers the way back from sign-in. The
calendar event is pinned in `golf-day.test.ts` too (dates, escaping, line
folding, the reminder, the Google link and the route), and the Bomb Squad
file was read back with Python's `icalendar` parser. So are the looks
(saved checked, shown to players, used by the calendar), the picture
upload (a logo and a photo through sharp into the art bucket), and the
missing-official warning. `__tests__/golf-day-look.test.ts` pins the look
rules, the theme merge, the colours suggested from a picture, and the
WhatsApp message word for word.

Migrations 033 and 034 were applied to a local Postgres 16 after
001–032, each twice. Every new rule was exercised there: a trip's swing
on two courses the same day, the second on one hole refused by the
index, tomorrow's hole refused, a rand or wrong prize refused, a dollar
bet outside a golf day refused, joining after a trip's last day refused,
and a golf day swing taken before 033 backfilled to the slot `day`, so a
second swing there is still refused.

Migrations 001–029 were applied to a local Postgres 16. Every trigger rule
was exercised there: full, over, not joined, wrong hole, wrong prize, not
yet, one swing, switched off, and deleting a golf day that has swings. So
was a race of two sessions for the last place. The screen was checked in a
browser at phone width, signed out, joined before the day, and on the day
with the confirm sheet open.
