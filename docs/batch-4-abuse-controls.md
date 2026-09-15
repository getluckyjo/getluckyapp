# Batch 4 — Abuse controls

Closes AUDIT.md B.8 (rate limiting that did nothing, and two open email
endpoints). Observability itself landed in Stage 2; this batch finishes the
abuse side.

## What changed

**Rate limiting that works on Vercel** (`src/lib/rate-limit.ts`, migration 009)
- One atomic counter per (rule, key) in Postgres, hit by the routes through
  the service role with `rate_limit_hit()`. Fixed window. The old in-memory
  Map in the proxy is deleted; on Vercel it had one empty map per instance
  and limited nothing.
- **Why Postgres and not Upstash/Vercel KV** (the audit plan named those):
  it already exists in every environment including staging, needs no new
  vendor, account or secret, and volumes are tiny. The backend is behind one
  function; swapping to Redis later is a 30-line change in one file.
- Per-user limits are tight; per-IP limits are at least 20× looser, on
  purpose. A corporate day puts 120 golfers behind one clubhouse Wi-Fi
  address. A test pins that ratio.

  | Rule | Where | Per user / 10 min | Per IP / 10 min |
  |---|---|---|---|
  | checkout | `POST /api/payments/payfast` | 10 | 300 |
  | bet_create | `POST /api/bets/create` (polls ~7× per payment) | 40 | 1200 |
  | claim | `PATCH /api/bets/[id]`, `POST /api/verifications/[id]` | 20 | 600 |
  | upload | `/api/videos/upload-url`, `/uploaded` | 20 | 600 |
  | age_check | `POST /api/profile/age-check` | 10 / hour | 300 / hour |
  | membership | `GET /api/membership/status` | 60 | — |
  | admin | every `/api/admin/*` (inside `requireAdmin`) | 600 | — |
  | auth_confirm | `/auth/callback`, `POST /auth/confirm/verify` | — | 60 |

- A limited request gets **429 `RATE_LIMITED`** with `Retry-After`, and a
  `rate_limit.tripped` warning in the logs. **Fails open**: if the counter
  cannot be reached the request is allowed and `rate_limit.backend_unavailable`
  is captured in Sentry. A database blip must not become an outage on the
  money path.
- Sign-in itself (OTP, magic link, Google) goes browser → Supabase and is
  covered by Supabase's own auth rate limits, which you should review under
  Authentication → Rate Limits before any marketing push.

**Two open endpoints removed**
- `POST /api/email/welcome` (unauthenticated; would send a branded email to
  any address) is deleted. The template moved to `src/lib/email/welcome.ts`
  and the sign-in completion calls it directly and **awaits** it. That also
  fixes the welcome emails that were silently not being sent: the old
  fire-and-forget fetch was killed when the function returned.
- `POST /api/leads` (unauthenticated write with the service role; orphan of
  the deleted landing page) is deleted. The `leads` table stays, locked as
  it was, so any real partner or investor leads captured before are not
  lost. Drop it in Batch 7 once you have exported them.

**Tests**: 232. New suite for the limiter (limits, independence, IP
fallback, window reset, fail-open, header parsing, the 20× ratio), a checkout
test for the 11th request, and the sign-in tests now assert the welcome email
goes to the session's own address.

## Apply order

Migration 009 first, then deploy. The order is not critical (without the
function the limiter fails open and logs), but the limiter only does its job
once the function exists.

1. Run `supabase/migrations/009_rate_limits.sql`. Its self-test at the end
   should show three rows: allowed, allowed, not allowed.
2. Merge and deploy.
3. Check Supabase → Authentication → Rate Limits and set the email and OTP
   limits to what launch-day sign-ups need.

## What to test on the preview URL

1. Sign in as `golfer01@getlucky.test`, open the browser console and run:
   ```js
   for (let i = 1; i <= 11; i++) {
     const r = await fetch('/api/payments/payfast', { method: 'POST', headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ tier: 'tier_1', courseId: '<a partner course id>', holeId: '<one of its hole ids>' }) })
     console.log(i, r.status)
   }
   ```
   Ten `200`s then a `429`. Wait ten minutes (or delete the row from
   `rate_limits` in the SQL editor) and it clears.
2. `POST /api/email/welcome` and `POST /api/leads` → 404.
3. Create a brand-new user (Google or a fresh email) and complete sign-in: the
   welcome email arrives. Sentry/logs show `auth.welcome_email_sent`.
4. `select * from rate_limits` shows keys like `checkout:user:<uuid>` and
   `checkout:ip:<address>`.

## Risk that remains

- **Fail-open is a choice.** A sustained attack that also takes the database
  down would not be rate-limited. That attack already takes the site down;
  the limiter is not the last line.
- **Fixed windows allow a burst of 2× at the boundary** (10 at 09:59, 10 at
  10:00). Acceptable at these limits.
- **The `rate_limits` table grows** by one row per (rule, user or IP) per
  window; the function deletes rows older than a day on about 1% of calls.
  At 100× today's volume that is a few thousand rows.
- **Per-IP limits are generous by design.** They will not stop a distributed
  script; the per-user limits and the money-path invariants from Batches
  1–3 are what stop that from mattering.
- **`clientIp` trusts `x-forwarded-for`.** On Vercel that header is set by
  the platform; anywhere else it would be spoofable.
