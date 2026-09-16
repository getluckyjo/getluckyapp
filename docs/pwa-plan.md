# PWA conversion — plan and decisions (Phase 1)

Written before the code, as the brief asked. The brief also asked for a
go-ahead before implementation; that was given in advance ("do as much as
you can while I sleep"), so this document records the decisions the code
then follows. Where the brief and the codebase disagree, the codebase wins
and the difference is noted.

## What is already there

The app is closer to an app shell than the brief assumes.

| Brief assumes | Actual |
|---|---|
| Next.js 15 | Next.js 16.3 (App Router, Turbopack builds), React 19 |
| Cormorant Garamond / DM Sans, deep green and gold | V2 design system: Poster Gothic (display), Inter (body), brand green `#345231`, lime `#d6fb4b` accent, grey surface `#ebedea`. Gold survives only as the prize colour on dark green. The PWA stays inside this system; "active state in gold" becomes the design's own active state (Poster Gothic label, lime Play disc). |
| No bottom navigation yet | `src/components/layout/BottomTabBar.tsx` already renders the designer's five-slot pill: Home, Winners, Play (lime disc), Club, Account. Bet history and legal pages live in the burger menu (`AppMenu.tsx`). |
| No safe-area handling | `viewportFit: 'cover'` is set and the header, tab bar, drawer and onboarding screens already pad with `env(safe-area-inset-*)`. |
| No iOS meta | `appleWebApp` metadata (capable, black-translucent, title) is set in `src/app/layout.tsx`. |

### Routing structure

`src/app` route groups:

- `(onboarding)`: `/splash`, `/onboarding`, `/auth` (+ `/auth/callback`, `/auth/confirm`), `/age-check`, `/welcome`
- `(dashboard)`: `/home`, `/history`, `/leaderboard`, `/account`
- `(membership)`: `/membership`
- `(play)`: `/select-course` → `/choose-stake` → PayFast → `/payment-return` → `/record` → `/confirm` → `/result/{win,miss}` → `/verify`. Wrapped in `BetProvider` (in-memory bet state; the PayFast leg is bridged through `localStorage.pf_pending`).
- `(admin)`: `/admin/*`, its own sidebar layout, desktop only.
- Public: `/`, `/terms`, `/privacy`, `/responsible-play`, `/witness/[token]`.
- `api/*`: all data access; every page is a client component that fetches from these.

`/` is a server component that reads the session cookie and redirects to `/home` or `/splash`.

### Where the shell lives

Every screen renders inside `PhoneFrame` (`src/components/layout/PhoneFrame.tsx`): on desktop a phone bezel, on phones a `100vw × 100dvh` box whose `.phone-screen-content` is the scroll container. The tab bar is `position: absolute` inside that box, so the body never scrolls on a phone. There is no shared layout component: each page composes `PhoneFrame` + `AppHeader` + `BottomTabBar` itself. That is left as is (12 call sites, all consistent); the PWA chrome (update toast, install prompts, feedback button) is mounted once in the root layout instead.

### Auth and sessions

- `@supabase/ssr` on both sides. The browser client (`src/lib/supabase/client.ts`) stores the session in cookies, not localStorage, so the server, the proxy and the browser all read the same session.
- `AuthContext` subscribes to `onAuthStateChange`; `supabase-js` refreshes the access token itself and on `visibilitychange`.
- `src/proxy.ts` (Next 16's middleware) gates the play flow with `getUser()` and redirects to `/auth?next=/select-course`. Dashboard routes are public and render a signed-out state.
- Sign-in is magic link **or a six-digit code** typed into the same screen. The code path is what makes the installed app workable on iOS: an installed web app has its own cookie jar, so a link opened in Safari cannot sign in the home-screen copy, but a code typed inside it can.

### What conflicts with a service worker

1. **Auth callbacks and PayFast.** `/auth/callback`, `/auth/confirm`, `/payment-return`, `/api/payments/*` and the PayFast ITN must never be served from cache. Same for `*.supabase.co` and `payfast.co.za`. These are on an explicit network-only list, registered before any other route.
2. **Sentry tunnel.** `/monitoring` proxies browser events; network-only.
3. **`/` is dynamic** (reads the cookie). It is not precached and not cached at runtime; the installed app's `start_url` points at it and lets it redirect.
4. **RSC payloads.** Client navigations fetch `?_rsc=` payloads. They are network-first with a short timeout, not stale-while-revalidate, so a returning user never sees a stale route tree.
5. **Personal data in HTML.** None: pages are client components and fetch from `/api/*` after mount, so the HTML shell of `/home` or `/account` is the same for every user. Page HTML on an allow-list is therefore safe to cache stale-while-revalidate; `/api/*` is never cached.
6. **Turbopack.** `@serwist/next` is webpack-only. The Turbopack path is `@serwist/turbopack`: the worker is bundled by esbuild inside a route handler at `/serwist/sw.js` (served with `Service-Worker-Allowed: /`) and the precache manifest is computed from `.next/static` at build time. In development the route still exists but registration is disabled.
7. **`/_next/image` and course photos.** Cached, but capped (entries and age), so the cache cannot grow without bound.

## Decisions

### Tabs

Keep the five the designer drew: **Home, Winners, Play, Club, Account.** They are the destinations a golfer touches on a course day; My bets, How it works and the legal pages stay in the burger menu. Changing this would undo the V2 design work for no user gain.

### Manifest

`src/app/manifest.ts`: name "Get Lucky Hole in One Challenge", short_name "Get Lucky", `display: standalone`, `orientation: portrait`, `start_url: /?source=pwa` (the root page forwards `source` to `/home` or `/splash`, and the analytics wrapper reads it), `theme_color` and `background_color` `#345231`. Icons 192/256/384/512 plus a maskable 512, generated by `npm run pwa:assets` from the existing composed icon. Apple touch icon 180. iOS splash screens for twelve current iPhone sizes, also generated, wired as `apple-touch-startup-image` links from `src/lib/pwa/splash.json`.

### Caching (Serwist)

| Request | Strategy |
|---|---|
| `/_next/static/*` (hashed) | precache + cache-first |
| Google Fonts CSS and files, `/fonts/*`, `/brand/*`, `/icons/*` | cache-first, 1 year |
| `/marketing/*`, `/_next/image` | stale-while-revalidate, 60 entries, 30 days |
| Page HTML on the allow-list (`/home`, `/leaderboard`, `/membership`, `/account`, `/history`, `/select-course`, `/splash`, `/onboarding`, `/auth`, `/terms`, `/privacy`, `/responsible-play`) | stale-while-revalidate |
| RSC payloads for the same allow-list | network-first, 3 s timeout |
| Everything on the deny list (`/api/*`, `/auth/callback`, `/auth/confirm`, `/payment-return`, `/admin/*`, `/witness/*`, `/monitoring`, `/serwist/*`, Supabase, PayFast, Sentry) | network-only, explicitly |
| Any other document that fails | branded `/~offline` fallback |

`skipWaiting` is off. A waiting worker shows the "New version available" toast; tapping it sends `SKIP_WAITING` and reloads when the new worker takes control.

### Beta gate

Off by default (`BETA_GATE` env unset). When `BETA_GATE=on`, the proxy checks every non-public page route: the signed-in user's email must be on the `beta_access` table, or the request must carry a cookie set by redeeming an invite code at `/beta`. Both lists are rows in one table (`kind = email | code`), edited from `/admin/beta` without a deploy. The check is one `security definer` function call so nothing about the list is readable through the public API.

### Feedback

Floating button on every screen, opens a sheet, posts to `/api/feedback`: message plus route, user agent, standalone flag, build SHA and date, screen size, and the user id when signed in. Stored in `feedback`, emailed to the ops address through the existing outbox.

### Analytics

Nothing is wired today and Vercel Web Analytics is not enabled on the project. The brief says "otherwise Plausible"; the choice here is **Vercel Web Analytics** instead: the project is already on Vercel Pro, it needs no new account or DNS, custom events are one call, and it can be read from this session. One dashboard switch is needed (project → Analytics → Enable). Events: `pwa_install`, `session_start` (with `standalone`), `course_selected`, `stake_chosen`, `payment_started`, `bet_created`, `result_declared`, `claim_submitted`, `feedback_sent`.

### Push notifications

Deferred to after beta, with the flag and the reasoning in `docs/pwa-push.md`. iOS needs 16.4+ **and** the app on the home screen before `PushManager` exists at all; the sending side needs VAPID keys, a subscriptions table, an outbox job and a permission moment that earns it. None of that is needed to run a closed beta.

### Out of scope for this pass

Phase 2 (TWA/APK) and Phase 3 (Capacitor). Device testing on real phones (this environment has no phone; `BETA-TESTING.md` lists the exact checks for the first morning).
