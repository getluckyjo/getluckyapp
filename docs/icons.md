# Back an Icon

The Icons tab (it replaced Club, which is parked until the membership
product is ready) lets a golfer pick which Icon they think holes it at
Icons Cup South Africa. One pick per golfer, changeable until the event.

## What the app states, and what it does not

The proposal to the Icons Series is confidential and says no prize is
announced before cover is confirmed in writing. The screen therefore names
the event, the venue and the dates (`src/lib/icons.ts`, one place to change
them) and asks one question. It never mentions a prize, a share, an
insurer or a charity. Keep it that way until Johannes says otherwise.

## Pieces

| Piece | Where |
|---|---|
| Tables | migration 018: `icons` (the field), `icon_votes` (one row per golfer, primary key `user_id`) |
| Field management | `/admin/icons`: add, reorder, hide or delete; live pick counts |
| Public read | `GET /api/icons`: active Icons, counts, shares, the caller's pick |
| Pick | `POST /api/icons/vote { iconId }`: signed in, active Icon only, upsert on `user_id`, rate-limited |
| Screen | `/icons`: list with a share bar per Icon; signed out sees the standings and a sign-in button |
| Analytics | `icon_backed` with `icon_id` and whether it was a change |

RLS: `icons` is readable by everyone; `icon_votes` is readable only by its
owner; neither is writable by the anon or authenticated role. The public
route counts with the service role.

## Apply order

1. Migration 018 on production (`supabase/migrations/018_icons.sql`).
2. Deploy.
3. Add the field at `/admin/icons`. Until then the tab says "The field
   hasn't been announced yet."
