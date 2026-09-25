---
name: golf-day
description: Set up a sponsored golf day in the Get Lucky app with its own unique link, so every player who joins through it gets one free swing at a prize on the day, on chosen par 3s, with the golf day's tab in place of Icons. Use when someone wants to add, sponsor, brand or prepare a golf day, a corporate day, a club day or an event swing ("give every player at X a free shot at R100K"), change one, or get its link and player instructions.
---

# Add a golf day

A golf day is a row in `golf_days` with its holes (`golf_day_holes`). Its
link is `https://www.getluckyholeinone.com/golf-day/<slug>`. Players who join
through the link get the golf day's tab in place of Icons and one free swing
(`tier_golf_day`) on the day (South African time), on its holes, for its
prize. Everyone else keeps Icons. Read `docs/golf-days.md` for how it works,
and `supabase/migrations/029_golf_days.sql` for the rules.

The facts (date, holes, prize, places) are data, set at `/admin/golf-days`
with no deploy. The look (a host's photo and colours) is code, in
`src/lib/golf-days/themes.ts` plus `public/golf-days/<slug>/`. A golf day
with no theme gets the Get Lucky look, and needs no code at all.

## 1. Get the details

Ask for anything missing. Do not guess the date, prize or venue.

| Detail | Notes |
|---|---|
| Name | As players know it: "Bomb Squad Golf Day" |
| Link slug | 2–40 lower-case letters, digits or dashes. It cannot change once sent, so agree it first |
| Tab label | 12 characters at most ("Bomb Squad"). Shown in the tab bar |
| Date | One day. The swing works 00:00–23:59 South African time |
| Venue and courses | One hole per course the day is played on (e.g. East and West) |
| Prize | Rand, up to R1 000 000 |
| Players | The cap on joins. Add a few spare for late entries |
| Who covers the prize | If Get Lucky covers it itself (not Indwe), no golf day screen may say it is insured. The golf day screens already say "paid by Get Lucky"; keep it that way |
| Branding | Optional: a photo and the host's artwork (a can, a logo) for colours |

## 2. Choose the holes

- Find the courses and holes: `grep -n -i "<club>" supabase/migrations/019_top100_courses.sql`,
  or Admin → Courses.
- **Check the club's own scorecard** (usually a PDF on the club's website)
  before trusting the app's distances. Migration 019's numbers can be out of
  date: Royal Johannesburg West's were, and 029 corrects them. If they are
  wrong, fix them in Admin → Courses, or with a guarded update in the
  migration (update only rows still carrying the old value).
- A hole must be a par 3 of at least 140 m (`src/lib/holes.ts`), active, at a
  partner course. The admin refuses anything else.
- Johannes's brief for golf days: a **signature par 3 of about 150 m** on
  each course, not the longest. Find the signature holes in course reviews
  (satop100courses.com course pages, the club's site): water carries,
  elevated tees, holes the club has reworked as showpieces. Then pick the
  one nearest 150 m from the tee the day will play.
- Say which tee the distance is from (club/yellow for men, usually), and
  name the alternative when the most famous hole is not near 150 m.
  Example: Royal West 17 is 185 m from yellow and 161 m from white.
- The app stores one distance per hole. If the day plays another tee,
  change that hole's distance in Admin → Courses to match.

## 3. Create it

**Usually: the admin.** `/admin/golf-days` → New golf day: link, name, tab
label, date, prize, players, then pick each hole (course, then hole). It
answers with the link to copy.

**When a branded look ships in the same pull request,** seed the golf day in
a migration too, so it exists the moment the code does. Follow 029's pattern,
idempotent:

```sql
insert into public.golf_days (slug, name, tab_label, plays_on, prize_pence, max_players, note)
values ('<slug>', '<Name>', '<Tab label>', date 'YYYY-MM-DD', <rand * 100>, <players>, '<venue; who covers the prize>')
on conflict (slug) do nothing;

insert into public.golf_day_holes (golf_day_id, hole_id)
select d.id, h.id
  from public.golf_days d
  join public.courses c on lower(c.name) = lower('<exact course name>')
  join public.holes h on h.course_id = c.id and h.hole_number = <n>
 where d.slug = '<slug>'
on conflict do nothing;
```

Repeat the second insert for each course. End with a verify `select` that
lists the golf day's holes with par, distance, `is_active` and `is_partner`.
Use the next free migration number. Add a row to
`supabase/check-migrations.sql`.

## 4. Brand it (optional)

1. Put the photo in `public/golf-days/<slug>/hero.jpg`, about 1000 px wide.
   Brighten it if asked. Lift the shadows more than the highlights so the
   sky does not blow out:

   ```bash
   node -e "require('sharp')('<source>').resize({ width: 1000 }).modulate({ brightness: 1.18, saturation: 1.06 }).gamma(2.2, 1.9).jpeg({ quality: 82, mozjpeg: true }).toFile('public/golf-days/<slug>/hero.jpg')"
   ```

   Look at a before and after side by side before keeping it.
2. Add a theme to `THEMES` in `src/lib/golf-days/themes.ts`, keyed by slug.
   Take `ink`, `accent`, `paper` and `page` from the host's artwork. Use the
   `accent` for rules and shadows only, never for text (gold on white is too
   faint). Write a one-line `tagline`.
3. An alcohol brand needs a `footnote` such as "<Brand>. Not for sale to
   persons under the age of 18. Enjoy responsibly."
4. Check it in a browser at 390 px wide, signed out and on the day. See
   "Checking the screen" below.

## 5. Before the link goes out

- Club officials for claims: Admin → Courses → Contacts, for each course.
- Supabase: Authentication → Rate Limits. Raise the email limit (default 30
  an hour) before a large group signs up.
- Terms: `/terms` says every prize is insured by Indwe. If Get Lucky covers
  this one, flag that the terms need a golf day line. Do not rewrite legal
  copy unasked.
- Dry run: a test golf day dated today with one hole. Join on two phones,
  take a swing, film it, declare a miss, then switch it off in the admin.

## 6. Hand over

Give the person:

- the link, in full;
- a short message for players (template below; adapt names, holes and
  prize, and use the `johannes-voice` skill if Johannes wants it in his
  voice);
- the date and holes as the app shows them, and the alternatives;
- the go-live checklist from step 5, with anything still open.

> **<Golf day> × Get Lucky: one free swing each for R<prize>**
>
> 1. **Before the day:** open <link> on your phone. Sign in with Google or your email, confirm you're 18 or older, and tap **Join**. A **<Tab label>** tab appears at the bottom of the app.
> 2. **On the day:** at <course> hole <n> (or <course> hole <n>), open the **<Tab label>** tab and tap the hole you're on.
> 3. **Film it:** hand your phone to a playing partner to film your tee shot in the app.
>
> Hole it, and once the club and your playing partners confirm it, R<prize> is yours.

## Checking the screen

The golf day screen needs a signed-in player and the API. To see it without
a real account:

1. Build with placeholder env: `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=x NEXT_PUBLIC_SITE_URL=https://ci.invalid npm run build`, then start it with `npx next start -p 3100`.
2. With Playwright (installed globally in the cloud container), open
   `/golf-day/<slug>` at 390×844 in a context made with
   `serviceWorkers: 'block'`: once the app's service worker takes control,
   its requests bypass Playwright's routes. Answer `**/api/golf-days/<slug>` with
   `{ golfDay, me }` in the shape `PublicGolfDay` / `GolfDayMe`
   (`src/lib/golf-days/rules.ts`), and `**/api/golf-days` with
   `{ tab: { slug, tabLabel } }`.
3. For a signed-in state, set the cookie `sb-placeholder-auth-token` to
   `base64-` plus base64url of a session JSON. The session needs a user and
   an `expires_at` in the future. Answer `https://placeholder.supabase.co/**`
   with a profile for `/rest/v1/profiles`.
4. Screenshot signed out, joined before the day, on the day (the hole
   buttons), and with the confirm sheet open. Check the tab label fits
   beside Account.

## Don'ts

- Don't change a golf day's slug after the link is out. The admin doesn't
  allow it.
- Don't give the golf day tier a prize in `src/lib/tiers.ts`. The prize is
  per golf day, on the bet.
- Don't make the golf day tab show for players who have not joined. The app
  is also shown to Icons Cup partners, who must see Icons.
- Don't mention Indwe or insurance on a self-covered golf day's screens.
