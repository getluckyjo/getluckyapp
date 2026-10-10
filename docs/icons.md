# Back an Icon

The Icons tab (it replaced Club, which is parked until the membership
product is ready) lets a golfer pick which Icon they think holes it at
Icons Cup South Africa. One pick per golfer, changeable until first tee.

## What the app states, and what it does not

Icons Cup South Africa is Team South Africa vs Team World at The Links
at Fancourt, 11–13 December 2026. The event is public
(icons-series.com), so the screen shows the launch graphic, names the
event and the teams and marks the captains. Get Lucky has not signed
with the organisers yet, so since 7 October 2026 the footer reads "A Get
Lucky fan pick for Icons Cup South Africa" instead of "Get Lucky is a
proud sponsor of Icons Cup South Africa", and the prize card ends with
"Subject to confirmation". Put the sponsor line back and drop the
confirmation line once the organisers sign.

On 16 September 2026 Johannes set the prize split, shown as three tiles
on a green card: R1m ×3 "Fans who backed the Icon", R4m "The Icon", R3m
"A charity they support", captioned "R10 million hole-in-one prize ·
T&Cs apply". On 6 October 2026 he made the Els for Autism Foundation
the charity partner for Icons Cup South Africa: the R3m tile reads "Els
for Autism Foundation" and the money goes there whoever holes it. The
intro is one line ("Who holes it on the Get Lucky hole? Pick one.
Change it any time before the first tee."); the event's venue and dates
are on the launch graphic and not repeated. The "You're backing" card
carries the one sentence a golfer needs at the moment of picking: "If
Ernie Els holes it, you are in the draw for R1 million." All copy lives
in `src/lib/icons.ts`. The screen still does not name the insurer.
Terms for the fan prize need to exist somewhere a golfer can read them
before the event.

Standings show a count of golfers backing each Icon, with a bar drawn
against the most-backed Icon and a "Fan favourite" tag on the leader.
It is one pick per golfer, so a percentage of picks would mislead
(three picks would read as 67%).

Player photos need rights; the seed ships without them and the cards show
initials. Add a photo URL in the admin once rights are confirmed.

## The field

Migration 018 seeds the sixteen Icons announced by 16 September 2026:
Team South Africa, captain Ernie Els: Schalk Burger, AB de Villiers,
Fourie du Preez, Butch James, Victor Matfield, Vernon Philander, Shaun
Pollock. Team World, captain José María Olazábal: Jimmy Anderson, Ash
Barty, George Gregan, Brian Lara, Yuvraj Singh, John Terry, Dwight
Yorke. Fourteen a side eventually; add the rest at
`/admin/icons` as they are announced (name is unique, re-running the
migration is a no-op).

## Pieces

| Piece | Where |
|---|---|
| Tables | migration 018: `icons` (the field: team, captain flag, tagline, photo, order, active), `icon_votes` (one row per golfer, primary key `user_id`) |
| Field management | `/admin/icons`: add, reorder, hide or delete; live pick counts |
| Public read | `GET /api/icons`: active Icons, counts, shares, the caller's pick |
| Pick | `POST /api/icons/vote { iconId }`: signed in, active Icon only, upsert on `user_id`, rate-limited |
| Screen | `/icons`: hero, the field by team with a share bar per Icon; signed out sees the standings and a sign-in button |
| Analytics | `icon_backed` with `icon_id` and whether it was a change |

RLS: `icons` is readable by everyone; `icon_votes` is readable only by its
owner; neither is writable by the anon or authenticated role. The public
route counts with the service role.

## The fan prize: cut-off, freeze, draw (migration 036)

Three R1m prizes go to fans who backed the Icon who holes it. The ace
itself is confirmed by the live broadcast and the organisers' result, not
through the app. What the app has to prove is who had backed that Icon
when the ball dropped, and that the three names came from that list by a
method anyone can re-run. `src/lib/fan-prize.ts` holds the rules; the
panel at the top of `/admin/icons` runs them.

1. **First tee.** `icon_events.first_tee_at` (seeded 07:00 SAST on
   11 December as a placeholder; set the real tee time in the admin). From
   that moment `POST /api/icons/vote` answers 409 `PICKS_CLOSED`, and a
   trigger on `icon_votes` refuses the write whatever route tries. The
   Icons tab shows "Picks close at first tee, Fri 11 Dec, 07:00" and locks
   the cards afterwards. Removals still go through, so deleting an account
   still cascades.
2. **Freeze** (`POST /api/admin/icons/event/freeze`, once). Every pick is
   copied to `icon_vote_snapshot` with the golfer's email and eligibility
   (18+ verified, not an admin, not suspended, profile exists), and the
   SHA-256 of the sorted `user_id:icon_id` lines goes on the event. Picks
   close at once if first tee has not passed. **Publish the hash before
   the shot is played** (a tweet, the Icons tab, an email to Indwe).
3. **Draw** (`POST /api/admin/icons/event/draw`, once). Enter the Icon who
   holed it and a seed nobody could have known at the freeze: the JSE All
   Share close on the day, the evening's lottery numbers, a number read
   out on air. Each eligible backer of that Icon is ranked by
   HMAC-SHA256(seed, user_id); the lowest three win. The winners, their
   ranks, the seed and a hash over the whole draw are written and cannot
   be edited (`fan_prize_winners`, append-only).
4. **Record** (`GET /api/admin/icons/event/record`). A JSON file with the
   frozen list (ids only, no names or emails), both hashes recomputed
   from the stored rows, the seed and the winners, and the method in
   words. Send it to Indwe with the broadcast evidence.

Every pick, change and removal is also logged in `icon_vote_events`
(append-only), so the snapshot can be checked against the history. An
Icon with picks can no longer be deleted (the foreign key restricts);
hide it instead.

Terms: section 5 of `/terms` describes the draw as above. It still needs
the lawyer's read on the launch checklist.

## Apply order

1. Migration 018 on production (`supabase/migrations/018_icons.sql`).
2. Deploy.
3. The seeded field shows at once; add newly announced Icons at `/admin/icons`.
4. Migration 036 (`supabase/migrations/036_icons_fan_prize.sql`) before
   the deploy that carries the fan prize panel; then set first tee at
   `/admin/icons`.
