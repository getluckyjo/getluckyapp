# Get Lucky Hole in One Challenge — Stage 1 Audit

Date: 15 September 2026
Scope: `getluckyjo/getluckyapp` at commit `f95c252` (branch `main` as merged). Read-only. No code was changed.
Deployed at: `www.getluckyholeinone.com` (Vercel project `get-lucky-golf`, Pro plan, Node 24, production deployment READY).

> **Read section B.0 first.** Three findings are active and exploitable today by anyone with an account and the public anon key. They do not need the frontend, a bug, or a race. They are Row Level Security policies that grant far more than intended, and one of them hands out admin.

An important caveat on what "today" means: this audit reads the migration files in `supabase/migrations/`. Those files are not a faithful record of production. The repo history shows a migration (`003_membership.sql`) that was written, possibly applied, then deleted from git; the code reads a `courses.image_url` column that no migration creates; and the funnel's `members` and `payments` tables live in the same Supabase project but are defined nowhere here. Every RLS finding below should be confirmed against the live project before remediation, and the fix plan starts with exactly that.

---

## A. Map of what exists

### A.1 Stack as actually found

| Claimed in brief | Found in repo |
|---|---|
| Next.js 15 | Next.js **16.1.6**, React 19.2.3, App Router. `src/proxy.ts` is the Next 16 replacement for middleware. |
| Tailwind CSS 4 | Tailwind 4 is imported in `globals.css` but effectively unused: one utility class in the whole app. Styling is 1,786 lines of hand-written CSS plus 586 inline `style={{}}` objects (the entire admin panel is inline-styled). |
| Design: deep green and gold, Cormorant Garamond, DM Sans | Code uses Poster Gothic (self-hosted OTF), Inter, brand green `#345231` and lime `#d6fb4b`. There is no Cormorant, no DM Sans, no gold anywhere in `src/`. Either the brief's design line is stale or the app is. Please confirm before Stage 3, because "design system stays" needs a definition. |
| Supabase, Payfast, Resend, Vercel | Confirmed. |

No server actions exist. All mutations go through API route handlers or direct Supabase calls from the browser.

### A.2 Route inventory

**Pages (all reachable in production unless noted).** Gating column is what `src/proxy.ts` enforces server-side; "client" means only the page's own `useEffect` redirect protects it.

| Route | What it does | Gate |
|---|---|---|
| `/` | Server component; redirects to `/home` or `/splash`. Proxy forwards stray `?code=` / `?token_hash=` to the auth routes. | — |
| `/splash`, `/onboarding` | Marketing intro screens. | public |
| `/auth` | Google OAuth, email magic link, six-digit OTP entry. | public |
| `/auth/confirm` | Holds a POST button so mail scanners can't consume the token. | public |
| `/age-check` | Self-declared DOB + consent; **writes `age_verified_at` from the browser** (B.5). | ungated by design |
| `/welcome` | "All set" beat. | client |
| `/payment-setup` | Writes `payment_method` to profile from the browser. Not linked from the current flow; orphan (A.5). | proxy |
| `/home` | Dashboard, shows pending claim CTA. | public (renders signed-out state) |
| `/history` | Lists own bets via `/api/bets?limit=200`. | public (API 401s) |
| `/leaderboard` | **Hard-coded fictional winners** presented as real payouts (B.11). | public |
| `/account` | Edits name/handicap via direct `profiles.upsert` from the browser. | public (API 401s) |
| `/membership` | Marketing for the external funnel. | public |
| `/select-course`, `/choose-stake`, `/record`, `/confirm`, `/result/claim`, `/result/miss`, `/verify` | The play flow (course → stake → Payfast → record video → declare → claim/miss → verification status). | proxy: session required |
| `/payment-return` | Payfast return URL; polls `/api/bets/create` until the ITN lands. | ungated by design |
| `/admin`, `/admin/bets`, `/admin/courses[/new|/[id]]`, `/admin/users[/[id]]`, `/admin/verification-queue[/[id]]`, `/admin/reports` | Admin panel. Layout gate is **client-side only** (`profile.is_admin`); every `/api/admin/*` route re-checks server-side, which is correct. But see B.1: the flag it checks is user-writable. | client + API |
| `/terms`, `/privacy`, `/responsible-play` | Legal. | public |

**API routes.**

| Route | Auth | Client used | Notes |
|---|---|---|---|
| `POST /api/payments/payfast` | session | user (RLS) | Signs Payfast checkout form. Does **not** validate `courseId`/`holeId` exist, belong together, or are active (B.3). |
| `POST /api/payments/payfast/notify` | Payfast IP allow-list (prod only) + MD5 + phone-home validate | service role | Writes `payfast_payments` ledger. Good structure; see B.3 for the sandbox foot-gun and the idempotency bug. |
| `POST /api/bets/create` | session | user (RLS) | Requires a `complete` ledger row owned by the caller. Good. Idempotency check is incomplete (B.3). |
| `GET /api/bets` | session | user | Own bets. |
| `GET/PATCH /api/bets/[betId]` | session | user | PATCH allows `miss`/`claimed` with **no state machine** (B.4). |
| `GET/POST /api/verifications/[betId]` | session | user | POST upserts the claim; **resets rejected/approved claims** (B.4). Accepts arbitrary doc paths. |
| `POST /api/videos/upload-url` | session | user | Signed upload URL under `${uid}/${betId}/`. Correct. |
| `POST /api/videos/verify` | session (optional!) | user | Mock "AI" that sleeps 1.5–2.5 s and writes **any client-supplied `storagePath`** to `bets.video_url` (B.4). |
| `GET /api/courses` | none | user | Public, cached 5 min. Falls back to a 1,180-line seed file with non-UUID ids (A.5). |
| `POST /api/leads` | **none** | **service role** | Orphan from the deleted `/app` landing page. Unauthenticated write + email (B.8). |
| `POST /api/email/welcome` | **none** | — | Sends a branded email to any address supplied (B.8). |
| `GET /api/membership/status` | session | service role | Reads the funnel's `members` table by email match. |
| `POST /api/auth/send-email` | Standard Webhooks HMAC | — | Supabase Send Email hook → Resend. Well done; timing-safe compare, tolerance window. |
| `GET /auth/callback`, `POST /auth/confirm/verify` | — | user | PKCE / token_hash exchange → `finishSignIn`. Open-redirect protected by an allow-list. Good. |
| `/api/admin/*` (17 handlers) | `requireAdmin()` | service role | Verifications list/detail/PATCH/batch, bets list/detail/PATCH, courses CRUD, holes CRUD, users list/detail/PATCH(suspend), stats, reports (revenue, payouts), export CSV. Every one has a `MOCK_ADMIN` branch that is dead in production. |

### A.3 Data model

All tables `public.*`, all with RLS enabled. Column lists abbreviated to what matters.

| Table | Key columns | Written by |
|---|---|---|
| `profiles` (1:1 `auth.users`) | `name`, `handicap`, `home_course_id`, `payment_method`, `payment_token`, `onboarding_done`, `payment_setup_done`, `total_attempts`, **`is_admin`**, `suspended_at`, `suspended_reason`, `date_of_birth`, **`age_verified_at`**, `terms_accepted_at` | trigger `handle_new_user` on signup; browser (`/age-check`, `/account`, `/payment-setup`); `finishSignIn` (server, user client); admin suspend (service role); RPC `increment_attempts` |
| `courses` | `name`, `location_text`, `region`, `lat/lng`, `is_partner`, (`image_url` — **not in any migration**) | admin CRUD (service role); seed |
| `holes` | `course_id`, `hole_number`, `par`, `distance_metres`, `is_active`, `jackpot_amount` (unused by the app) | admin CRUD; seed |
| `bets` | `user_id`, `course_id`, `hole_id`, `tier`, `stake_pence`, `potential_win_pence`, `status` (`active|miss|claimed|verified|paid`), `payment_intent_id` (partial unique), `video_url`, `declared_result`, `declared_at` | `/api/bets/create` (user client), `/api/bets/[id]` PATCH (user), `/api/verifications/[id]` POST (user), `/api/videos/verify` (user), ITN reference swap (service role), admin PATCH/approve (service role), **and any user directly via PostgREST** (B.2) |
| `verifications` (1:1 `bets`) | `status` (`pending|documents_received|under_review|approved|rejected`), `certificate_path`, `affidavit_path`, `footage_received_at`, `documents_received_at`, `verified_at`, `payout_initiated_at`, `reviewer_notes`, `reviewed_by` | `/api/verifications/[id]` POST (user client), admin PATCH/batch (service role), **any user directly** (B.2) |
| `payfast_payments` | `m_payment_id` (unique), `pf_payment_id`, `user_id`, `course_id`, `hole_id`, `tier`, `amount_cents`, `status` (`complete|amount_mismatch`), `raw_payload` | ITN only (service role). Users can read their own. Correctly locked. |
| `leads` | `email`, `lane`, `name`, `company`, `note` | `/api/leads` (service role). No policies = locked to service role. Correct, but the writer is unauthenticated. |
| External: `members`, `payments` | Owned by the membership funnel. Contains `mobile`, `payfast_token`, `referral_code`, etc. | Not this app. **RLS state unknown from this repo.** The app reads `members` with the service role. |
| Storage `shot-videos` (private) | `${uid}/${betId}/shot.{webm,mp4}` | Signed upload URL from `/api/videos/upload-url`. Policies scope to the owner's folder. Correct. |
| Storage `verification-docs` (private) | `${betId}/{certificate|affidavit}/${file.name}` | Browser upload direct to storage. Policies grant **every authenticated user** insert/update/select on the whole bucket (B.2). |

Relationships: `bets.user_id → auth.users` (not `profiles`), which is why the PostgREST joins `bets → profiles(name)` in `admin/export`, `admin/reports/payouts` and `admin/users/[id]` cannot resolve. Those three queries will error or return null names in production; the code silently maps `?? ''`. Nobody has noticed because the admin panel was built against mock data.

Indexes present: `bets(user_id)`, `bets(status)`, `bets(course_id)`, `bets(payment_intent_id) where not null` (unique), `verifications(status)`, `verifications(bet_id)` (unique), `payfast_payments(user_id)`, `payfast_payments(pf_payment_id)`, `leads(created_at)`, `leads(lane)`. Missing: `holes(course_id)` (FK without index; small table, low impact), `bets(created_at)` (every admin list sorts on it), `verifications(created_at)`.

### A.4 Third-party integrations and credentials

| Service | Where used | Credential | Where it lives |
|---|---|---|---|
| Supabase (auth, Postgres, storage) | everywhere | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public by design), `SUPABASE_SERVICE_ROLE_KEY` (server only) | Vercel env. Service role is read only in `src/lib/supabase/admin.ts` and never has a `NEXT_PUBLIC_` prefix. Not in the client bundle. ✅ |
| Payfast | `/api/payments/payfast`, `/notify` | `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`, `PAYFAST_SANDBOX` | Vercel env. **Code defaults to the public sandbox merchant (`10000100` / `46f0cd694581a`) and `SANDBOX=true` when unset** (B.3). |
| Resend | welcome email, leads email, Supabase auth-email hook | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `LEADS_TO_ADDRESS` | Vercel env. Falls back to the literal string `'placeholder'`. |
| Supabase Auth Hook | `/api/auth/send-email` | `SEND_EMAIL_HOOK_SECRET` | Vercel env. |
| Google OAuth | via Supabase | configured in Supabase dashboard | not in repo |
| Membership funnel (`membership.getluckygolfclub.com`) | shares the Supabase project; app reads `members` | — | Separate repo `getlucky-subscriptions` on the same Vercel team |
| Direct Postgres (`scripts/run-sql.mjs`) | one-off migrations | `DATABASE_URL` / `PG*` | Local env; uses `pg` which is **not in package.json**, and `ssl: { rejectUnauthorized: false }`. |

Env vars referenced but never read anywhere: `NEXT_PUBLIC_PAYFAST_SANDBOX` (documented in `docs/payfast-go-live.md`, unused). `ENABLE_MOCK_ADMIN` + `NODE_ENV=development` enables an unauthenticated admin in dev; harmless in prod, but it is a foot-gun to keep.

I could not read Vercel's environment variable values (the API doesn't expose them). **You need to confirm by hand, today, that production has `PAYFAST_SANDBOX=false` and a non-empty `PAYFAST_PASSPHRASE`.** See B.3 for why this matters more than it sounds.

### A.5 Dead code, orphans, duplication

**Orphaned routes and references**
- `POST /api/leads` — its only caller (`src/app/app/page.tsx` landing page) was deleted; the route is still deployed and unauthenticated.
- `'/app'` in `PUBLIC_ROUTES` (`src/proxy.ts:72`) — route no longer exists.
- `/payment-setup` page — writes `payment_method`/`payment_setup_done`, reads `pending_name`/`pending_handicap` from localStorage that nothing sets. Nothing links to it.
- `profiles.payment_token`, `profiles.home_course_id`, `holes.jackpot_amount` — columns never read by the app (`jackpot_amount` is only written by admin; prizes come from `tiers.ts`).
- `BetContext.setVideoUploadPath` / `videoUploadPath` — defined, never called. This is the missing link that would have saved the video path (B.4).
- `docs/auth-email-setup.md` describes a Facebook sign-in that does not exist in code.
- `types/database.ts` — used by one file (`AuthContext.tsx`), missing `payfast_payments` and `leads`, includes `members`. Neither Supabase client is created with the `Database` generic, so every query in the app is effectively untyped.

**Mock / fallback branches that are dead in production**
- `MOCK_ADMIN` and `auth.isMock || !auth.adminClient` branches in all 17 admin handlers, plus `src/lib/admin-mock-data.ts` (108 lines). `formatZAR` and `timeAgo`, which real pages import, live in that mock file.
- `betId.startsWith('bet_mock')` / `'bet_fallback'` guards in `/api/verifications/[betId]`, `/api/videos/verify`, `/verify`, `/result/miss`.
- `supabaseUrl.includes('YOUR_PROJECT_REF')` checks in `proxy.ts`, `admin-auth.ts`, `videos/upload-url`, `supabase/client.ts`.
- `src/data/south-africa-courses.ts` (1,180 lines): fallback for `/api/courses` when the DB returns nothing. Its ids are `sa-top100-001`, not UUIDs. If it ever serves in production, checkout succeeds and `bets/create` fails on the FK. It also hot-links 96 images from `satop100courses.com`.

**Duplicated logic**
- Tier price table exists twice: `BET_TIERS` in `lib/tiers.ts` and `TIER_ZAR` in `api/payments/payfast/route.ts`. A test asserts they agree, which is a smell, not a fix.
- Payfast IP allow-list exists twice: 81 IPs in the route, **32 IPs re-declared inside the test**, which asserts "exactly 32". The test passes against a copy, not the code.
- `requireAdmin` + `adminClient` fetch-related-rows-then-join-in-JS pattern is copy-pasted six times (`verifications`, `verifications/[id]`, `bets`, `stats` ×2, `users`).
- `getInitials`, `formatRand` reimplemented in `leaderboard`, `account`, `choose-stake`.
- `FROM_ADDRESS` default declared in three routes.

**Unused dependencies**: `clsx`, `tailwind-merge`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` (vitest runs in `node` env). Missing dependencies used by scripts: `pg`, `playwright`, `tsx`.

**Repo clutter**: five PNG screenshots (~4.6 MB) at the repo root, a `SVG/` folder of design exports, `design/` (a full design-handoff package with fonts and a validator script), `docs/*.pdf` + `*.docx` binaries, a boilerplate `README.md`, one-off SQL files with a personal Gmail address and a specific user UUID in them (`supabase/apply-003-and-admin.sql`, `lookup-admins.sql`, `verify-admin.sql`, `watch-bet.sql`, `check-latest-bet.sql`).

**Build state**: `tsc --noEmit` clean. `eslint` reports 9 errors (8 `prefer-const`, 1 `react-hooks/set-state-in-effect`) and 8 warnings. `vitest`: 72 tests pass. `npm audit --omit=dev`: 1 critical (`next` 16.1.6, patched in a later 16.x), 4 high (`nanoid`, `postcss`, `sharp`, `ws`), 4 moderate. No CI exists; nothing runs on PRs.

---

## B. Security assessment

Severity key: **Critical** = exploitable now, direct money or full-control impact. **High** = exploitable now with real impact, or a design gap that defeats a control. **Medium** = needs a precondition or has bounded impact. **Low** = hygiene.

### B.0 Stop-the-line summary

If production matches the migrations, any signed-in user with the anon key can:

1. **Make themselves admin** with one PostgREST call, then approve their own claim and mark it paid through the real admin API. (B.1)
2. **Create a bet for free** at any tier and prize, or set an existing bet to `verified`/`paid` with a R1,000,000 `potential_win_pence`. (B.2)
3. **Approve their own verification** by writing `status='approved'` to `verifications`. (B.2)
4. **Read every other claimant's certificate and affidavit**, and overwrite them. (B.2)

None of this touches your frontend. The calls are the same ones the app itself makes, with different column values. Fix order is in section E; the SQL for the first three is small and can be applied in an hour once confirmed against the live schema.

Second thing to do today: look at the Supabase project's `profiles` table for `is_admin = true` rows. `supabase/lookup-admins.sql` is a committed note about "the ONE unknown admin account" (`60e950e9-…`). If that was never explained, B.1 is one plausible explanation.

### B.1 Row Level Security

**Critical — `profiles` grants users full write to their own row, including `is_admin`.**
`supabase/migrations/001_schema.sql:25-28`
```sql
create policy "Users can manage their own profile"
  on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
```
`src/lib/admin-auth.ts:44-50` decides admin by reading `profiles.is_admin`. So:
```
PATCH https://<project>.supabase.co/rest/v1/profiles?id=eq.<my-uid>
apikey: <anon>   Authorization: Bearer <my-jwt>
{"is_admin": true}
```
After that, every `/api/admin/*` route accepts the caller, and the admin UI renders for them (the layout reads the same flag). From there: approve any verification, PATCH any bet to `paid`, export all users, delete courses, suspend anyone.

The same policy also lets a user set `age_verified_at` (defeats the only server-side age gate, B.5), clear `suspended_at` (defeats suspension), zero `total_attempts`, and set `payment_setup_done`. The deleted `003_membership.sql` in git history shows the author understood this exact problem for membership columns and wrote a guard trigger for them; nothing equivalent protects `is_admin`.

**Critical — `bets` lets users insert and update any column.**
`001_schema.sql:134-143`. Insert policy checks only `user_id = auth.uid()`. Update policy the same. Consequences:
- Free bet: `POST /rest/v1/bets {user_id, course_id, hole_id, tier:'tier_5', stake_pence:0, potential_win_pence:100000000, status:'active'}`. `payment_intent_id` is nullable and the unique index is partial, so no payment reference is needed. `/api/bets/create` is careful; the table is not.
- Self-verify: `PATCH /rest/v1/bets?id=eq.<bet> {"status":"paid"}` or `"verified"`. Admin reports (`/api/admin/reports/payouts`, `users` totals, `stats`) then report it as paid out.
- Rewrite history: change `tier`, `stake_pence`, `declared_result`, `declared_at`, `video_url`, `payment_intent_id` on any own bet at any time.

The `bet_status` enum constrains values, not transitions.

**Critical — `verifications` lets users insert and update any column.**
`001_schema.sql:159-190`. A user can insert a row for their bet with `status:'approved', verified_at: now(), payout_initiated_at: now(), reviewed_by: <any uuid>`, or update an existing `rejected` row to `approved`. The admin queue filters by status, so a self-approved row lands in the "approved" bucket looking reviewed.

**Critical (PII) / High (integrity) — `verification-docs` bucket is readable and writable by every authenticated user.**
`001_schema.sql:232-251`: `auth.role() = 'authenticated'` on insert, update and select for the whole bucket. `storage.objects` select also permits listing. Any account can enumerate and download every certificate and affidavit ever uploaded (names, signatures, club letterheads, possibly ID numbers), and with `upsert: true` (`result/claim/page.tsx:111`) overwrite any of them. The upload path is `${betId}/${type}/${file.name}` with the raw client filename.

**High — `increment_attempts(user_id)` is `security definer` and callable by any authenticated user with any `user_id`.** `001_schema.sql:52-63`. Minor in itself (inflates a counter) but it is the pattern: an unguarded privileged RPC. `EXECUTE` should be revoked from `anon` and `authenticated`.

**Fine**: `courses`/`holes` public read, `payfast_payments` read-own/no-write, `leads` no policies, `shot-videos` scoped to `${uid}/`.

**Unknown**: RLS on the funnel's `members` and `payments` tables. They hold `mobile`, `payfast_token` and payment history for every member and sit in the same project as this app's anon key. If they have permissive policies, this app's key exposes them. Check in the Supabase dashboard.

### B.2 Service role key usage

Read in exactly one place (`src/lib/supabase/admin.ts`), server-only, no `NEXT_PUBLIC_` prefix, not present in git history, not in any client component. ✅

Used by: `requireAdmin` (after session check ✅), Payfast ITN (webhook-authenticated ✅), `/api/membership/status` (session-checked ✅), and **`/api/leads` (no authentication, no rate limit beyond the in-memory default, no field length limits)** — Medium. The insert is bounded to one table with fixed columns, so blast radius is spam, not data access, but an unauthenticated route holding the master key is the wrong shape.

### B.3 Payment integrity (Payfast)

The ITN handler is the best-built part of the codebase: IP allow-list in production, MD5 over the raw ordered payload, phone-home `validate`, merchant-id check, amount compared against the tier in integer cents, ledger written by upsert on `m_payment_id`, bets granted only against a `complete` ledger row owned by the caller, course/hole/tier taken from the signed `custom_str1..4` rather than the browser. Good work. The problems are around it.

**Critical (configuration) — sandbox is the default and cannot be distinguished from production at runtime.**
`api/payments/payfast/route.ts:9-12`, `notify/route.ts:156-158`. If `PAYFAST_SANDBOX` is unset or anything other than the string `false`, production sends golfers to `sandbox.payfast.co.za` with Payfast's public test merchant, skips the IP check, and phones home to the sandbox validator. A sandbox "payment" costs nothing and produces a **real** bet with a **real** R25,000–R1,000,000 prize. I cannot verify the env from here. Confirm it; then make the code refuse to start in sandbox when `VERCEL_ENV === 'production'`.

**High — one payment can yield two bets (idempotency gap).**
`bets/create/route.ts:46-54` looks up an existing bet by `payment_intent_id = m_payment_id`. The ITN (`notify/route.ts:335-341`) later rewrites that column to `pf_payment_id`. Sequence: ITN writes ledger → browser creates bet with `gl_…` → ITN's swap step runs → user refreshes `/payment-return` (the `pf_pending` localStorage key is only cleared on success, and any interruption re-runs the flow) → lookup by `gl_…` finds nothing → insert with `gl_…` succeeds because the unique index now holds `pf_…`. Two `active` bets, one payment. The comment says "matches either reference"; the code matches one.

**High — `m_payment_id` is predictable and collides.** `gl_${tier}_${Date.now()}`. Two golfers at the same tier in the same millisecond get the same id; the ledger upsert keyed on it overwrites the first user's row with the second's `user_id`, and the first user's bet creation then fails with "belongs to another user". Unlikely at today's volume, plausible at a corporate day, trivial to fix (UUID).

**Medium — checkout does not validate the target.** `payfast/route.ts:89-98` accepts any `courseId`/`holeId` strings. Nothing checks the hole exists (FK will), belongs to that course, is `is_active`, is par 3, or that the course is a partner. A user can bind a paid bet to an inactive hole or to a hole at a course you have no agreement with. `bets/create` then falls back to the client's ids if the ledger's are null.

**Medium — amount mismatch is recorded, not alerted.** `notify/route.ts:286-291` logs to console only. There is no alerting anywhere (D.4).

**Medium — the ITN's outer `catch` returns 200.** `notify/route.ts:349-353`. A thrown error after validation (say, a JSON parse of `raw_payload`) tells Payfast "done" and the payment is lost silently; the ledger path itself correctly returns 500.

**Low** — `merchant_key` is included in the checkout form (required by Payfast, fine). Hard-coded sandbox credentials in source (public values, but remove the defaults). `encodeURIComponent` differs from PHP `urlencode` on `!*'()` — a name with those characters produces a signature Payfast rejects; the `safeUserName` regex strips some but not all.

Quantity cannot be manipulated (one entry per payment, amount fixed per tier server-side). Price cannot be manipulated (amount checked against tier on both ITN and bet creation). Replay of a genuine ITN is idempotent via upsert.

### B.4 Claim and result integrity — the fraud surface

Trace of how a hole-in-one is recorded today:

1. Bet created `active` after payment. No expiry, no tee time, no location.
2. `/record`: browser captures video with `MediaRecorder`; `startBackgroundUpload` PUTs the blob to a signed URL under `${uid}/${betId}/shot.webm`. **The resulting path is never written to `bets.video_url`** (`setVideoUploadPath` exists but is never called; `upload-url` doesn't persist it either).
3. `/confirm` calls `POST /api/videos/verify` with `storagePath: null` (`confirm/page.tsx:41`). The route is a stub that sleeps 1.5–2.5 s and returns `verified: false`. With a null path it writes nothing.
4. User taps "I holed it" → `/result/claim` → uploads certificate + affidavit **directly from the browser** to the open `verification-docs` bucket → `POST /api/verifications/[betId]` sets `bets.status='claimed'`, `declared_result='win'`, `declared_at=now()` (server time ✅) and **upserts** `verifications` to `documents_received`.
5. Admin opens the queue, PATCHes `approved`, bet becomes `verified`. Nothing ever sets `paid`; admin can PATCH it manually.

Findings:

**High — the admin never sees the footage.** Because of step 2/3, `bets.video_url` is null for every real bet, so `videoSignedUrl` in `/api/admin/verifications/[id]` is null and the queue shows claims with no video. Your entire evidence chain rests on two documents the claimant uploads themselves. This is a bug, not an attack, but it means the process you think you have does not exist.

**High — `video_url` is client-controlled.** `videos/verify/route.ts:192-196` writes whatever `storagePath` the client sends (anything not starting with `mock/`) to the caller's bet. A user can point it at any object key. The admin route then signs a URL for that key with the service role, which bypasses storage RLS — so a claimant can make the admin viewer display another user's video, or a file they uploaded elsewhere.

**High — no state machine, no replay protection.** `bets/[betId]/route.ts:233-249` restricts the *target* status to `miss|claimed` but not the *source*: `miss → claimed` (declare a win after you already declared a miss), `claimed → miss`, `verified → claimed`, and repeated `declared_at` rewrites are all allowed. `verifications/[betId]/route.ts:80-89` upserts on every submit, so a **rejected** claim can be resubmitted and lands back in the queue as `documents_received` with the same `verifications.id`, with `reviewer_notes` and `reviewed_by` from the rejection still attached but the status reset. Nothing records that a rejection happened. The same POST also downgrades a `verified` or `paid` bet to `claimed`.

**High — no binding between bet, video, place and time.** Nothing constrains when the video is recorded relative to the bet (a bet can sit `active` for months), where it was recorded (no geolocation, no course check), or that the uploaded bytes came from the in-app recorder (the signed URL accepts any file; a pre-recorded or edited clip uploads the same way). `footage_received_at` is set by the claim route to `now()` regardless of whether footage exists. No hash of the video is stored, so later substitution is undetectable. `certificate_path`/`affidavit_path` are arbitrary strings from the client.

**Medium — evidence documents are user-overwritable after submission** (bucket policy + `upsert: true`), so what the admin reviews on Tuesday may not be what was uploaded on Monday, and there is no record either way.

**Medium — no admin audit trail.** `reviewed_by`/`reviewer_notes` are the only trace and are overwritten on each PATCH. Batch approve of up to 50 with one note. No record of who set a bet to `paid` or when.

**What an underwriter will ask for, and what you can currently produce**

| They will ask | Today |
|---|---|
| Paid entry, by this person, for this hole, before the shot | Yes for entries created via the API; no for entries inserted via RLS (B.2). |
| The footage, timestamped, unaltered | Not linked to the claim (bug); not hashed; not server-timestamped at capture. |
| Witness / club confirmation | Two self-uploaded files, overwritable, in a bucket everyone can read. |
| Who reviewed it, when, what they saw | Last reviewer id only; previous decisions overwritten. |
| That it wasn't paid twice | `verified`/`paid` are free-text-equivalent statuses any user can set. |

Stage 4's design list is the right one. The minimum before you accept another claim is in E, batch 2.

### B.5 Authentication and authorisation

- **Sessions**: `@supabase/ssr` cookie sessions; proxy refreshes for gated routes; `getUser()` (not `getSession()`) on every API route. ✅ Root page uses `getSession()` for a redirect only — fine.
- **No passwords exist.** Sign-in is Google OAuth, magic link, or six-digit OTP. No password reset surface. `recovery` email template exists but is unreachable.
- **Email verification**: OTP/magic link inherently verifies; Google emails are verified by Google. ✅
- **Open redirect**: `safeNext` allow-lists `next`. ✅ `nextPathFrom` in the email renderer only accepts `/`-prefixed paths. ✅
- **Auth hook**: HMAC-verified, timing-safe, 5-minute tolerance. ✅
- **High — the age gate is client-enforced.** `age-check/page.tsx:70-74` writes `date_of_birth` and `age_verified_at` from the browser under the open `profiles` policy; `bets/create:30-41` trusts the column. A minor sets the column directly (or just types a fake DOB; it's self-declared anyway). This is a compliance control, not a security one, but it is currently theatre.
- **Medium — admin gating is correct in shape but keyed on a user-writable flag** (B.1). Once that is fixed, the model (client layout hides, API enforces) is fine.
- **Medium — suspension is not enforced anywhere.** `suspended_at` is set by admin and displayed, but no route checks it. A suspended user can pay, play and claim.
- **Low** — `ENABLE_MOCK_ADMIN` dev bypass in `admin-auth.ts:31-33,66-69`. Delete it.
- **Low** — Dashboard routes (`/account`, `/history`) are ungated in the proxy; the client APIs 401. Works, but the pages render empty shells for signed-out users.

### B.6 Input validation

No schema validation library is used anywhere. Every route destructures `await request.json()` raw and checks presence of a few fields. Specifics:

- `admin/courses` POST and `holes` POST pass `body.name`, `body.lat`, `body.hole_number` etc. straight to insert; Postgres types are the only guard. No length limits on text.
- `admin/verifications/[id]` PATCH accepts any `status` string; the enum rejects unknowns, but `pending` or `documents_received` can be set by admin, which the UI never intends.
- `/api/leads`, `/api/email/welcome`: unbounded `note`, `name`, `email` (only `includes('@')`).
- `verifications/[betId]` POST: `certificatePath`/`affidavitPath` unchecked strings.
- `videos/verify`: `storagePath` unchecked (B.4).
- Several routes return `error.message` from Supabase to the client (`bets/[betId]`, `verifications/[betId]`, all admin routes) — leaks table/column names. Low.
- **XSS**: none found. React escapes; email templates call `escapeHtml` on user-derived strings (`firstName`, `newEmail`). `dangerouslySetInnerHTML` is not used.
- **SQL**: no raw SQL from the app; PostgREST builder throughout. The only SQL runner is the local script. ✅
- **CSV injection**: handled in `admin/export`. ✅ (One of the few things with a test, although the test tests a copy.)

### B.7 Secrets

Scanned every revision of every branch for key patterns (Supabase JWTs, service role, Resend `re_…`, `whsec_`, Postgres URLs, AWS/Google/GitHub tokens, Payfast passphrases). **No real secret has ever been committed.** ✅ `.env*` is ignored and never appears in history.

Low-severity findings:
- Payfast public sandbox merchant id/key hard-coded as defaults in two routes.
- `RESEND_API_KEY` falls back to `'placeholder'` (fails at send time, but silently constructs a client).
- A personal Gmail address and two production user UUIDs are committed in `supabase/*.sql`; the Supabase project ref `ajsgzeofswlizwwdkesp` is in a comment. Not secrets, but not something to leave in a repo an external dev or pentester will receive.
- `scripts/run-sql.mjs` uses `rejectUnauthorized: false`.

No `NEXT_PUBLIC_` variable carries anything sensitive.

### B.8 Rate limiting and abuse

**High — the rate limiter does not work on Vercel.** `src/proxy.ts:5-68` is an in-memory `Map`. Vercel runs the proxy in many isolated instances that are created and discarded constantly; each has its own empty map. An attacker gets `limit × instances` and the map resets on every cold start. Treat the app as unlimited.

What that exposes:
- `POST /api/email/welcome` — unauthenticated; sends a branded email from your domain to any address with any `name`. A spammer can burn your Resend quota and domain reputation in minutes. **High.**
- `POST /api/leads` — unauthenticated DB write + email to your inbox with `replyTo` set to the attacker. **Medium.**
- `POST /api/payments/payfast` — authenticated; creates unbounded checkout sessions (no DB write until ITN, so cheap). Low.
- `POST /api/videos/verify` — authenticated; each call holds a function for 1.5–2.5 s. A loop of these burns compute. Medium.
- Account creation: Supabase's own OTP/email rate limits apply (per email, per IP, project-wide). Those are real, but they are Supabase's defaults, not something you have tuned or monitored.
- `/verify` polls `GET /api/verifications/[id]` every 10 s for as long as the tab is open; `/payment-return` polls create up to 7 times. Fine per user, but nothing caps it.

Credential stuffing is not applicable (no passwords). CAPTCHA: none anywhere.

### B.9 Multi-accounting

Nothing prevents it. Identity is an email address (Google or magic link). No phone verification, no device fingerprint, no ID check, no IP/device clustering, no "one account per person" rule enforced at the data level. There are currently no free plays or promotions to game, so the exposure today is claim-related: one person can enter the same hole many times under many accounts. That only matters if the underwriter's terms cap entries per person per day, which you should check, because the app cannot currently honour such a cap.

Membership status is matched by email to the funnel's `members` table (`membership/status/route.ts:380-386`). Anyone who signs up with a member's email gets the member badge, but Supabase verifies email ownership, so this is only a problem if the funnel stores unverified emails.

### B.10 PII and POPIA

**What is stored, where**

| Data | Location | Who can read it today |
|---|---|---|
| Email, Google profile name, last sign-in, IP (Supabase audit) | `auth.users` | Service role; the app never surfaces emails to admin (admin UI shows `email: ''`). |
| Name, handicap, DOB, consent timestamps, payment method | `profiles` | Owner; admin via service role. |
| Bets, stakes, results, Payfast ids | `bets`, `payfast_payments` (with full raw ITN payload incl. Payfast's copy of the payer's name/email) | Owner; admin. |
| Hole-in-one videos (faces, voices, bystanders) | storage `shot-videos` | Owner; admin. ✅ |
| Certificates and affidavits (names, signatures, likely ID numbers of four people who did not sign up to your app) | storage `verification-docs` | **Every authenticated user.** (B.1) |
| Lead emails/names/companies/notes | `leads` | Service role only. ✅ |
| Members' mobile numbers, Payfast tokens, referral data | funnel `members` | Unknown RLS. |

- **Encryption at rest**: Supabase encrypts disks by default. No field-level encryption; not needed for this data class if access control is right.
- **Deletion path**: none. No "delete my account" in the UI or API. `on delete cascade` exists from `auth.users` → `profiles`/`bets`, so deleting the auth user in the dashboard works, but storage objects are not cascaded and the `payfast_payments.user_id` is set to null (correct for a financial ledger).
- **Retention**: none defined. Videos and documents live forever.
- **Privacy page** mentions POPIA, Payfast, Supabase and deletion, which is more than most. It should not promise deletion that does not exist.
- **Breach embarrassment ranking**: (1) the open `verification-docs` bucket: third-party affidavits with signatures; (2) DOB + name + betting history in `profiles`/`bets` if `is_admin` is obtained via B.1; (3) the raw ITN payloads.
- The `payfast_payments.raw_payload` stores whatever Payfast sends; today that includes payer name and the generic email. Keep it (dispute evidence) but know it is there.

### B.11 Non-technical but material

**High — `/leaderboard` shows eight fabricated winners** with names, prize amounts, courses and dates (`leaderboard/page.tsx:20-50`), publicly, on a product that is insurance-backed and FSP-sponsored. "R500,000, Thabo M., Leopard Creek" reads as a claim of fact. This is the kind of thing an underwriter, the ASA, or a journalist notices before any RLS policy. Replace with real data or a clearly-labelled illustration before doing anything else in Stage 3; it is a ten-minute change.

---

## C. Code quality

**TypeScript.** `strict: true`, `tsc` clean. But: 27 `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments, all in admin routes, each followed by `any`-typed row mapping. No `@ts-ignore`. The Supabase clients are untyped (`createServerClient(url, key)` without `<Database>`), so `.from('bets').select(...)` returns `any`-shaped rows everywhere; the strictness is cosmetic on the data layer. `types/database.ts` is stale and used once.

**Error handling.** Pattern is `try { … } catch { return 500 'Internal error' }` with no logging in roughly 20 handlers (`bets/[betId]`, `verifications/[betId]`, `videos/*`, every admin route). Failures are invisible. Specific swallowed cases that matter:
- `finishSignIn` upsert result ignored; welcome-email `fetch` is fire-and-forget inside a serverless function, so it is killed when the response returns — welcome emails are probably not being sent.
- `increment_attempts` RPC errors swallowed by design.
- `notify` outer catch returns 200 (B.3).
- `videos/verify` DB write wrapped in a `catch {}` labelled "non-critical".
- `claim` page: upload failure logged to console, user sees "not done"; no server record.

**Consistency.** Three ways to touch the DB (browser client direct, API route with user client, API route with service role) chosen per-file without a rule. Money in "pence" columns holding cents. Two tier tables, two IP lists, three `FROM_ADDRESS` defaults. Admin panel has its own inline design system; player app has 1,786 lines of CSS with BEM-ish classes; Tailwind is loaded and unused. `docs/` and `design/` describe a V2 that partially matches the code.

**Tests.** 72 passing, and they prove almost nothing: they import `tiers.ts`, `payments.ts` and `auth-emails.ts`, and for everything else they **re-implement** the logic inside the test file (CSV escaping, field whitelisting, IP list, name sanitiser, limit parsing) and test the copy. The IP-list test asserts 32 IPs; the route has 81. No route handler, RLS policy, or DB interaction is tested. No CI.

Highest-value tests to write (Stage 2): (1) RLS as a normal user via PostgREST against a staging project: cannot write `is_admin`, cannot insert bets, cannot update `verifications`, cannot list `verification-docs`; (2) ITN handler with a recorded real payload: signature, amount mismatch, replay, ledger write; (3) `bets/create`: pending → created → idempotent under both reference ids; (4) claim state machine: every illegal transition returns 409; (5) auth email hook signature verification (already partly covered).

**Accessibility (core flows, quick pass).** Buttons are real `<button>` elements with `aria-label` where icon-only (25 inputs, 49 label/aria attributes). Three clickable non-buttons (`AppMenu` backdrop, `choose-stake` backdrop, admin breadcrumb `<span onClick>`). Camera flow (`/record`) has permission-state messaging. Contrast of lime-on-green and small 11px labels is unverified. `PhoneFrame` fixes the app to a phone-width column on desktop; keyboard focus order was not audited. Not a launch blocker; not good either.

---

## D. Scalability

Scenario: 120 golfers at one course in two hours plus a marketing spike. That is one entry every minute and perhaps 20 requests/second at the peak. **The database and Vercel will not notice.** Where it actually breaks:

**D.1 Queries.**
- `/api/admin/users` runs one `bets` query **per profile row** (N+1, `users/route.ts:833-838`) — 20 queries per page today, grows with `limit`.
- `/api/admin/stats` and `/api/admin/reports/revenue` load **every bet** into memory and reduce in JS. Fine at 1k bets, slow at 100k, OOM eventually. Should be SQL aggregates (`sum()` via RPC or a view).
- The fetch-then-join-in-JS pattern (six handlers) does 4–6 round trips per request. Not a scale problem; a latency and maintenance one.
- Admin `search` is post-filtered in JS after pagination, so page counts are wrong whenever a search term is present.
- `verifications` tier filter likewise post-filters. Wrong totals.
- Missing indexes: `bets(created_at)`, `verifications(created_at)`, `holes(course_id)`. `bets(user_id, created_at)` composite would serve `/api/bets` and history.

**D.2 Connections.** All access is PostgREST over HTTPS (Supabase API); there is no direct Postgres from the app, so serverless connection exhaustion does not apply. ✅ The only direct connection is the local SQL script.

**D.3 Synchronous work that should be queued.**
- Welcome email: currently a self-HTTP call from inside a request that returns before the fetch resolves. Move to a queue or at least await it.
- ITN `validate` phone-home has **no timeout**; if Payfast's validator hangs, the function holds until Vercel's limit and Payfast retries. Add a 10 s timeout.
- `/api/videos/verify` sleeps for effect. Remove.
- Video and document uploads go browser → Supabase Storage directly, not through Vercel. ✅ (Vercel's 4.5 MB body limit would otherwise break this.)
- Nothing else is heavy today. WhatsApp/PDF/image processing do not exist yet; when they do, they need a queue from day one (Supabase `pg_cron` + a table, or QStash/Inngest).

**D.4 Caching.**
- `/api/courses`: `public, max-age=300, stale-while-revalidate=86400`. Correct target, but it is a dynamic route handler on Vercel; CDN caching of route handlers requires the response to be cacheable at the edge, which this header achieves. ✅
- Nothing else cached. Correct for bets/verifications/profile (must never be cached). `/api/membership/status` could be cached per user for minutes.
- Course images are hot-linked from `satop100courses.com` for non-local courses; on a marketing spike that third party is your bottleneck and your outage.
- **Observability: none.** No Sentry, no structured logs, no alerts. `console.log` to Vercel's log drain, which retains little on Pro. Vercel's runtime error aggregator shows zero errors in the last 7 days, which mostly reflects that the app catches and hides them.

**D.5 Vercel limits on critical paths.** Pro plan: 60 s default function timeout (Fluid compute), 4.5 MB request body. The ITN, checkout, and bet creation are all sub-second. `payment-return` polls for ~32 s client-side; fine. Cold starts add ~300–800 ms to the first ITN after idle; Payfast tolerates it.

**D.6 Where it breaks.**
- **10×** (1,200 entries/2 h): nothing breaks except the admin stats page getting slow. The ITN is the single point of failure: one bad deploy, one new Payfast IP range, one expired passphrase, and every payment succeeds with no bet. That is a Day-1 risk, not a 10× risk, and there is no alert for it.
- **100×** (12,000 entries/2 h, ~2/second): still fine for Postgres and PostgREST on a Small instance. Admin `stats`/`revenue` become multi-second. The in-memory rate limiter is already meaningless. Supabase Auth's default OTP limits (e.g. 30 emails/hour project-wide on the free/default config unless raised) **would block sign-ups** at this rate; check the project's Auth rate-limit settings before any marketing push.
- The architectural ceiling is not throughput; it is the absence of a job queue, observability, and an idempotent, auditable state machine. Those are E batches 2 and 4, not a rewrite.

---

## E. Remediation plan

Ordered by risk-adjusted impact. Each batch is one PR, reviewable in one sitting. "Verify" is what you test on the preview URL or in the Supabase dashboard before sign-off. Batches marked ⚠️ touch money or claims and should not go to production until Stage 2's staging project and tests exist; batch 0 and 1 are the exception because leaving them open is worse than the risk of doing them carefully.

### Batch 0 — Today, no code (30 minutes)
1. Vercel → `get-lucky-golf` → Settings → Environment Variables, Production: confirm `PAYFAST_SANDBOX=false`, `PAYFAST_PASSPHRASE` non-empty, `PAYFAST_MERCHANT_ID` is the live id, `SUPABASE_SERVICE_ROLE_KEY` set, `SEND_EMAIL_HOOK_SECRET` set.
2. Supabase → Table editor → `profiles` → filter `is_admin = true`. Every row should be a person you can name. Resolve the "unknown admin" from `lookup-admins.sql`.
3. Supabase → Storage → `verification-docs` → look at what is in there and who it belongs to.
4. Supabase → Database → check RLS policies on `members` and `payments`.
5. Supabase → Settings → Add-ons: confirm Point-in-Time Recovery is on and note the retention window (Stage 2 item 5 — cheap to check now).
6. Export the current production schema (`supabase db dump --schema-only` or the dashboard) and commit it as the baseline. Everything after this needs to be diffed against reality, not against `001_schema.sql`.

### Batch 1 — RLS lockdown ⚠️ (SQL only, reversible, ~1 day)
**Changes**: one migration.
- `profiles`: replace the `for all` policy with `select` (own row) and `update` (own row) where the update policy or a `before update` trigger rejects changes to `is_admin`, `suspended_at`, `suspended_reason`, `total_attempts`, `age_verified_at`, `terms_accepted_at`, `date_of_birth` (after first set), `payment_setup_done` unless `current_user = 'service_role'`. The deleted `003_membership.sql` guard trigger is the template. No `insert`/`delete` for users (the trigger creates rows).
- `bets`: drop the user `insert` and `update` policies. Keep `select`. All writes move to the service role inside routes that already verify ownership (bets/create, bets/[id] PATCH, verifications POST, videos/verify).
- `verifications`: drop user `insert`/`update`. Keep `select`.
- `verification-docs`: change all three policies to `(storage.foldername(name))[1] = auth.uid()::text`; drop `update` entirely (submit once); change the claim page path to `${uid}/${betId}/…`.
- `revoke execute on function increment_attempts from anon, authenticated`.
**Could break**: every route and page that currently writes `bets`/`verifications`/`profiles` with the user client. That is why this batch also flips those routes to `createAdminClient()` after their existing `user_id` checks. The age-check and account pages keep working because their columns (`date_of_birth` first-set, `name`, `handicap`, `payment_method`) stay writable.
**Verify**: with a normal user's JWT and `curl` against PostgREST: `PATCH profiles {is_admin:true}` → 0 rows; `POST bets` → 403/42501; `PATCH verifications` → 0 rows; `GET storage/v1/object/list/verification-docs` → only own folder. Then play one full sandbox bet on the preview and confirm it still creates, declares and claims.
**Flag**: do this against staging first if Stage 2 lands within a week; otherwise do it against production behind a maintenance window with the dump from Batch 0 as rollback.

### Batch 2 — Claim integrity ⚠️ (~3 days)
- Server-side state machine in one module: `active→miss`, `active→claimed`, `claimed→under_review→approved|rejected`, `approved→paid`; everything else 409. Bet PATCH and verification POST route through it. `verifications` becomes insert-once; resubmission after rejection creates a new row (or is refused) and never touches the old one.
- Persist `video_url` from the upload-url route (server chooses the path; client never sends one). Delete the `videos/verify` stub or make it a no-op that does not write. Store `video_sha256` and `video_size` computed server-side on first admin fetch or via a storage webhook; store `recorded_at` from the server at upload time.
- Bet play window: `expires_at = created_at + N hours` (you pick N); recording/claiming after expiry is refused.
- Validate `certificatePath`/`affidavitPath` are under `${uid}/${betId}/`.
- Add `claim_events` (append-only, `actor`, `action`, `before`, `after`, `created_at`, written by trigger on `bets` and `verifications`). This is a schema addition — flagging for approval as the brief requires. It is the audit log Stage 4 asks for and it is cheaper to add now than to backfill.
- Enforce `suspended_at` in checkout, bet creation and claim.
- Replace the leaderboard's fictional winners (B.11). Two-line change; goes in this PR because it is about claims credibility.
**Could break**: the `/verify` page's status mapping; admin queue expectations about `documents_received`. **Verify**: full sandbox play-through for miss, claim, resubmit-after-reject (must fail), admin approve, admin pay; `claim_events` shows every step with actor.

### Batch 3 — Payment path hardening ⚠️ (~1 day)
- `m_payment_id` → `gl_${uuid}`.
- `bets/create` idempotency: look up existing bet by `payment_intent_id in (m_payment_id, ledger.pf_payment_id)`; or stop swapping the column and store `pf_payment_id` in its own column (preferred; it is already in the ledger).
- Checkout validates hole exists, `is_active`, belongs to course, course `is_partner`; `bets/create` refuses when the ledger's course/hole are null instead of falling back to the body.
- Refuse to run in sandbox when `VERCEL_ENV === 'production'`; remove hard-coded merchant defaults.
- ITN: 10 s timeout on `validate`; outer catch returns 500; `amount_mismatch` triggers an alert (Batch 4 provides the alert channel; until then, a Resend email to you).
**Verify**: sandbox payment with the return page refreshed mid-poll → exactly one bet; two tabs → one bet; tampered `holeId` → 400.

### Batch 4 — Abuse and observability (~2 days; overlaps Stage 2 item 4)
- Replace the in-memory limiter with Upstash Redis / Vercel KV sliding window, keyed by IP and by user id, on auth-adjacent, checkout, claim, upload-url, leads.
- Delete `/api/email/welcome`; call the send function directly (and await it) from `finishSignIn`.
- Delete `/api/leads` and the `leads` table, or move lead capture to the marketing site's repo with a CAPTCHA.
- Sentry with source maps; structured log helper; alerts for ITN failures, `amount_mismatch`, `bets/create` 5xx, claim POST 5xx, auth hook 401/500.
**Verify**: hammer `/api/payments/payfast` from two IPs → 429 after the limit, consistently across cold starts; trigger a deliberate ITN signature failure on preview → alert arrives.

### Batch 5 — Validation and error handling (~2 days)
- Zod schema per route; one `parseBody()` helper; one `apiError()` helper that logs with a request id and never returns `error.message` to the client.
- Replace every empty `catch {}` with logged handling.
- Remove `ENABLE_MOCK_ADMIN`, all `MOCK_ADMIN` branches, `admin-mock-data.ts` (move `formatZAR`/`timeAgo` to `lib/format.ts`), `bet_mock`/`bet_fallback` guards, `YOUR_PROJECT_REF` checks, the seed-data fallback in `/api/courses`.
**Verify**: `tsc`, lint clean (fix the 9 errors here), tests green; every route returns a structured 400 on bad input.

### Batch 6 — Admin correctness and queries (~2 days)
- Fix the impossible `bets → profiles` joins (add an FK `bets.user_id → profiles.id`, or query `profiles` separately). Today three admin views silently show blank names.
- Surface user emails to admin via `auth.admin.listUsers` / a `profiles.email` column maintained by trigger.
- Replace the N+1 in `admin/users` and the full-table reduces in `stats`/`revenue` with SQL aggregates (a view or RPC).
- Move search/tier filters into the query so pagination totals are right.
- Add indexes: `bets(created_at desc)`, `bets(user_id, created_at desc)`, `verifications(created_at)`, `holes(course_id)`. Prove with `explain analyze` before/after (Stage 4 asks for timings; capture them here).
**Verify**: admin pages against staging with ~5k seeded bets; page loads < 500 ms.

### Batch 7 — Dead code, dependencies, repo hygiene (~1 day, low risk)
- Remove `clsx`, `tailwind-merge`, `@testing-library/*`, `jsdom`; add `pg`/`tsx` as dev deps or delete the scripts; `npm audit fix` (Next 16.1.x patch, not a major).
- Decide Tailwind: keep and use, or remove the import. Recommendation: remove; the app has a CSS system already.
- Regenerate `types/database.ts` from the live schema (`supabase gen types`) and type both clients.
- Delete `/payment-setup`, `setVideoUploadPath`, `'/app'` route entry, `NEXT_PUBLIC_PAYFAST_SANDBOX` from docs, Facebook from docs, root PNGs/SVG folder (move to `design/` or out of the repo), personal email and UUIDs from `supabase/*.sql`, boilerplate README (replace with the Stage 4 `ARCHITECTURE.md` stub).
- Consolidate tier table, IP list, `FROM_ADDRESS`, `getInitials`/`formatRand`.
**Verify**: build, lint, tests; `npm ls` shows no extraneous packages.

### Batch 8 — POPIA (~1 day)
- Account deletion endpoint (auth user + storage objects; keep `payfast_payments` with `user_id` nulled, as designed).
- Retention rule for videos/docs on `miss` and `rejected` bets (e.g. 90 days), implemented as `pg_cron` or a scheduled function.
- Privacy page updated to match what actually exists.
- Confirm RLS on the funnel's tables or move them to their own project.

### Explicitly deferred to Stage 4
Geolocation and tee-time binding, witness/official confirmation flows, velocity rules, manual-review queue UX, load test, `ARCHITECTURE.md`. Batches 1–3 give those something sound to build on.

### Not recommended
- Rewriting the admin panel's inline styles, restyling the player app, or migrating to Tailwind. Cosmetic.
- Upgrading Next/React majors. Patch only.
- Building real video verification (computer vision). Human review with a proper evidence chain is the control; automation is a later optimisation.

---

*End of Stage 1. Nothing has been changed. Waiting for your review of Batch 0 results and approval of the batch order before Stage 2.*
