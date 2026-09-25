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

Everything is data, set at `/admin/golf-days` with no deploy: the facts
(date, holes, prize, places), the look (an uploaded logo or photo, colours,
host, tagline, small print; `golf_days.look`, migration 031) and the
WhatsApp message to send. Only a drawn tab icon is code. Claude's part is
the research (holes, the host's colours, the right words) and handing
Johannes the values; he types them into the admin.

## 1. Get the details

Ask for anything missing. Do not guess the date, prize or venue.

| Detail | Notes |
|---|---|
| Name | As players know it: "Bomb Squad Golf Day" |
| Link slug | 2–40 lower-case letters, digits or dashes. It cannot change once sent, so agree it first |
| Tab label | Shown in the tab bar, beside Home, Play and Account. Up to 7 characters sits like the other tabs. Longer (12 at most) is set smaller and cut short on a narrow phone: "Bomb Squad" showed as "BOMB SQ…", so Bomb Squad went with "BS". Suggest the host's initials or short name |
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
- A day on one course can have a single hole (SaSwazi: Umdoni Park 16).
  The screen then says "Hole 16", and the copy speaks of "the hole".
- When the published cards disagree, count the par 3s: a par 72 with four
  par 5s has four par 3s. Hole19 listed three for Umdoni Park; GolfPass's
  full card had the fourth.

## 3. Create it

**The admin does it all** (docs/golf-days.md, "Adding a golf day"):
`/admin/golf-days` → New golf day. Link, name, tab label, date, prize,
players, holes (course, then hole), then the look (step 4), then save. The
row answers with the link, and warns about a course with no club official
or a tab label over 7 characters. Claude has no access to production, so
hand Johannes the exact values to type, the hole choice with its reasons,
and anything to upload.

**A seed migration** only when a golf day must exist the moment a pull
request merges (Bomb Squad and SaSwazi were seeded because their looks
were code then). Follow 030's pattern, idempotent, with the look as JSON
in `look` (src/lib/golf-days/look.ts says what it may hold):

```sql
insert into public.golf_days (slug, name, tab_label, plays_on, prize_pence, max_players, note, look)
values ('<slug>', '<Name>', '<Tab label>', date 'YYYY-MM-DD', <rand * 100>, <players>, '<venue; who covers the prize>',
        '{"host": "<Host>", "venue": "<Venue>", "ink": "#rrggbb", "accent": "#rrggbb", "paper": "#rrggbb", "page": "#rrggbb"}'::jsonb)
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
`supabase/check-migrations.sql`. Test it on a local Postgres (apply
001 onwards, then run it twice).

## 4. Brand it (optional)

The look is set in the admin too, beside a preview that is the player's
screen's own card:

1. **Picture.** Upload the host's logo or a photo. The admin resizes it to
   a WebP of at most 1 000 px in the public `golf-day-art` bucket
   (migration 031). A picture with a see-through background is a **logo**,
   shown whole above the label (SaSwazi's sticker); otherwise a **photo**,
   filling the top with the label over its foot (Bomb Squad's cans). The
   choice can be switched. Brighten a dark photo before uploading it,
   lifting the shadows more than the highlights so the sky does not blow
   out, and look at a before and after side by side:

   ```bash
   node -e "require('sharp')('<source>').resize({ width: 1000 }).modulate({ brightness: 1.18, saturation: 1.06 }).gamma(2.2, 1.9).jpeg({ quality: 82, mozjpeg: true }).toFile('<out>.jpg')"
   ```
2. **Colours** are suggested from the picture: ink (type, lines, buttons),
   accent (rules and the button's shadow, never text: gold on white is too
   faint), card and page. The admin warns when ink on the card reads
   under 7:1. Check the suggestion against the host's artwork; a photo's
   accent comes out grey, so take it from the brand instead.
3. **Words.** Host ("Host × Get Lucky"), the venue as players know it
   ("Royal Johannesburg", not "Royal Johannesburg & Kensington"), the line
   under the prize (not the logo's own slogan again), and for an alcohol
   brand the 18+ line (one click).
4. **Tab icon** (optional, code): when the host has a simple mark, draw it
   as line work in `src/components/icons/index.tsx`, like `BombSquadIcon`
   (stroke 2.6 in a 40-wide viewBox, `currentColor`), and key it by slug
   in `GOLF_DAY_ICONS` in `src/components/layout/BottomTabBar.tsx`.
   Without one the tab shows a pin flag, which is right for a logo that
   is a whole scene (SaSwazi's). Compare it with the artwork at full size
   and at tab size (about 27 px).
5. **Check it** on a phone at 320 px and 390 px and on a computer (the
   app sits in a 375 px phone frame there), signed out and on the day. See
   "Checking the screen" below. Nothing on the label may run past its
   border.

`src/lib/golf-days/themes.ts` still holds the looks Bomb Squad and SaSwazi
shipped with, as the fallback under a saved look. A new golf day needs
nothing there.

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

One link is enough: joining leads straight into adding the app to the home
screen, and joined players get an Add to calendar button with the link in
the event. The message comes from the admin's message button
(src/lib/golf-days/message.ts holds its words; a test pins them); give it
in a plain block so the asterisks (WhatsApp's bold) survive. Johannes
likes it short and fun:

```
⛳ *<Golf day> × Get Lucky* 🍀

One free swing. One hole. *R<prize>* if it drops on *<Friday 2 October>*. 💰

📲 *Before <Friday>:* tap the link, sign in, hit *Join*, then add it to your home screen and calendar.
<link>

🏌️ *On the day:* at *<course> <n>* or *<course> <n>*, open the *<Tab label>* tab, tap your hole and get a mate to film it.

18+. One swing each. Swing like the rent's due. 🍀
```

On one course: "at <Venue>'s *16th*, … tap the hole …".

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
