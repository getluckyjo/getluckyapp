# Back an Icon

The Icons tab (it replaced Club, which is parked until the membership
product is ready) lets a golfer pick which Icon they think holes it at
Icons Cup South Africa. One pick per golfer, changeable until the event.

## What the app states, and what it does not

Get Lucky sponsors Icons Cup South Africa (Team South Africa vs Team
World, The Links at Fancourt, 11–13 December 2026). The event is public
(icons-series.com), so the screen shows the launch graphic, names the
event and the teams, marks the captains and carries a sponsor line. All
of that lives in `src/lib/icons.ts`. What the screen never mentions is a
prize, a share, an insurer or a charity: the arrangement in the proposal
is confidential and no prize is announced before cover is confirmed in
writing. Keep it that way until Johannes says otherwise.

Player photos need rights; the seed ships without them and the cards show
initials. Add a photo URL in the admin once rights are confirmed.

## The field

Migration 018 seeds the twelve Icons announced by 16 September 2026:
Team South Africa, captain Ernie Els: AB de Villiers, Fourie du Preez,
Schalk Burger, Butch James, Victor Matfield, Vernon Philander, Shaun
Pollock. Team World, captain José María Olazábal: John Terry, Brian
Lara, Ash Barty. Fourteen a side eventually; add the rest at
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

## Apply order

1. Migration 018 on production (`supabase/migrations/018_icons.sql`).
2. Deploy.
3. The seeded field shows at once; add newly announced Icons at `/admin/icons`.
