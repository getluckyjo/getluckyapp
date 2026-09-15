# Stage 2 — The safety net

What was built before any remediation from `AUDIT.md` is attempted, and how
to confirm each piece works. Five parts, in the order the brief asked for.

Everything here is repeatable: the scripts refuse to run against the
production Supabase project (`ajsgzeofswlizwwdkesp`), CI runs the same
commands you run locally, and the alerts fire through two channels so one
misconfiguration does not silence them.

---

## 1. Staging environment

**Design.** One extra Supabase project ("get-lucky-staging") that every
Vercel *Preview* deployment talks to. Production keeps its own project. The
app itself enforces the split at start-up (`src/instrumentation.ts`): a
preview deployment whose `NEXT_PUBLIC_SUPABASE_URL` is the production
project, or whose `PAYFAST_SANDBOX` is `false`, refuses to boot and reports
to Sentry.

**Set-up (once, ~20 minutes).**

1. Supabase dashboard → New project → name `get-lucky-staging`, same region
   as production (`af-south-1` if that is where prod lives; check under
   Project Settings → General). Note the project ref, anon key, service role
   key, and the database password.
2. Authentication → URL Configuration → Site URL
   `https://get-lucky-golf-git-main-get-lucky-golf-club.vercel.app`, and add
   `https://*-get-lucky-golf-club.vercel.app/**` plus `http://localhost:3000/**`
   to Redirect URLs. Enable the Google provider with the same client id
   (Google Cloud → add the staging Supabase callback URL as an authorised
   redirect).
3. Apply the schema:
   ```bash
   STAGING_DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
     npm run staging:bootstrap
   ```
   Uses the session pooler (port 5432). Applies `supabase/migrations/*.sql`
   in order, records each in `public.schema_migrations`, re-runs are no-ops.
4. Seed it:
   ```bash
   STAGING_SUPABASE_URL=https://<ref>.supabase.co \
   STAGING_SUPABASE_SERVICE_ROLE_KEY=<service-role> \
     npm run staging:seed
   ```
   Creates one admin (`seed-admin@getlucky.test`), 24 golfers
   (`golfer01@getlucky.test` … `golfer24@getlucky.test`, one suspended),
   ~60 bets across every status and tier with matching ledger rows,
   verifications for the claimed ones, placeholder footage and documents in
   storage, and two deliberately awkward ledger rows (an `amount_mismatch`
   and an orphan with no bet). Password for all seeded users is printed at
   the end (default `seed-Passw0rd!`; override with `STAGING_SEED_PASSWORD`).
   Re-running wipes and recreates the seeded bets.
5. Vercel → `get-lucky-golf` → Settings → Environment Variables. For the
   **Preview** environment only, set:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<staging-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | staging service role key |
   | `PAYFAST_SANDBOX` | `true` |
   | `PAYFAST_MERCHANT_ID` / `PAYFAST_MERCHANT_KEY` / `PAYFAST_PASSPHRASE` | your PayFast **sandbox** account (not the shared `10000100`) |
   | `SEND_EMAIL_HOOK_SECRET` | a new secret; configure the staging project's Send Email hook to `https://get-lucky-golf-git-main-get-lucky-golf-club.vercel.app/api/auth/send-email` |
   | `RESEND_API_KEY` | can be the same key; emails go to real addresses, so seeded users use `@getlucky.test` which never delivers |
   | `NEXT_PUBLIC_SITE_URL` | leave unset; previews derive the origin |
   | `OPS_ALERT_EMAIL` | `johannes@getluckygolfclub.com` |

   Make sure none of these are ticked for Production.
6. GitHub → repo → Settings → Secrets and variables → Actions: add
   `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`,
   `STAGING_SUPABASE_SERVICE_ROLE_KEY`. CI's RLS job uses them.

**How you verify it.**
- Open any PR; the Vercel preview URL boots. If it shows a 500 with
  "Refusing to start a preview deployment", the Preview env vars still point
  at production. That is the guard working.
- Sign in on the preview as `golfer01@getlucky.test`. `/history` shows seeded
  bets. Sign in as `seed-admin@getlucky.test`; `/admin/verification-queue`
  shows claims with certificate and affidavit files that open.
- Run `npm run test:staging` locally with the three `STAGING_*` variables set.
  The suite signs up two throwaway users and probes RLS. Today, the tests
  marked `fails` pass *because* the holes in `AUDIT.md` B.1 are open; after
  Batch 1 they must be flipped to `it(...)`.

---

## 2. Tests on the money paths

`npm test` runs in under two seconds with no network. What it covers:

| Suite | What it pins down |
|---|---|
| `__tests__/money/payfast-checkout.test.ts` | Session required; amount is chosen server-side per tier; user/course/hole/tier travel inside the signed payload; signature matches PayFast's algorithm computed independently; only `PAYFAST_SANDBOX=false` goes live. |
| `__tests__/money/payfast-itn.test.ts` | Bad signature, failed or unreachable validate, wrong merchant, non-PayFast IP in production: all rejected with nothing written. COMPLETE writes the ledger from the signed fields; amount mismatch and unknown tier are recorded as `amount_mismatch` with no tier; cents comparison; replay is idempotent; ledger failure returns 500 so PayFast retries; the bet reference swap never resets a resolved status. |
| `__tests__/money/bets-create.test.ts` | Missing fields, unknown tier, no session, age gate; 202 while the ITN is pending; 402 for mismatch, another user's payment, inconsistent tier/amount; 500 when the ledger is unreachable; the bet is built from the ledger row, not the body; idempotent; survives the insert race. **`it.fails`:** the double-bet after the ITN reference swap (AUDIT B.3, Batch 3). |
| `__tests__/money/claims.test.ts` | Declaring a miss with a server timestamp; only `miss`/`claimed` allowed to players; ownership scoping on every write and read (IDOR); claim submit opens a `documents_received` verification; upload slots are issued only under the caller's own folder. **`it.fails`:** miss→claim, editing a verified bet, reopening a rejected claim, evidence paths outside the caller's folder (Batch 1/2). |
| `__tests__/money/admin-auth.test.ts` | `requireAdmin`: 401/403/ok, no mock fallback in production; approval records reviewer + time and flips the bet to `verified`; rejection leaves it `claimed`. |
| `__tests__/money/auth-flow.test.ts` | `safeNext` allow-list (no open redirect); `finishSignIn` first-timer, age gate, returning user; `/auth/callback` good/bad/unreachable; `/auth/confirm/verify` GET never consumes a token, POST 303s, expired token, unknown OTP type coerced. |
| `__tests__/env-guard.test.ts` | The preview/production start-up guard. |
| `__tests__/api-security.test.ts`, `auth-email.test.ts` | Pre-existing unit tests, unchanged. |

The route tests import the real handlers and run them against
`__tests__/helpers/fake-supabase.ts`, an in-memory PostgREST look-alike, so
the handler's own logic, validation and branching is what is under test.
They do not test RLS; `__tests__/staging/rls.staging.test.ts` does that
against the real staging project.

**`it.fails` is a contract.** Each one describes behaviour the audit says is
wrong today. When the batch that fixes it lands, the test starts passing,
vitest reports the `fails` marker as an error, and the PR must flip it to a
normal `it`. That is how Stage 3 proves a fix rather than asserts it.

**How you verify it.** `npm test` → all green (and the `fails` tests listed
as passing-by-failing). Break something on purpose, e.g. comment out the
`payment.user_id !== user.id` check in `bets/create/route.ts`, run again,
and watch `402 when the payment belongs to a different user` go red.

---

## 3. CI

`.github/workflows/ci.yml` runs on every pull request and every push to
`main`: `npm ci`, `tsc --noEmit`, `eslint`, `vitest`, `next build` (with
placeholder env so it can never reach a real project). A second job runs the
RLS suite against staging when the GitHub secrets exist and warns when they
do not. Lint errors that existed before Stage 2 (9 of them, all mechanical)
were fixed so the first run is green; the 7 remaining warnings are
`<img>`/font advisories left for Batch 7.

**Blocking merges is a repository setting, not a workflow setting.** Do
this once:

GitHub → repo → Settings → Branches → Add branch protection rule
- Branch name pattern: `main`
- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging → search and tick
  `typecheck · lint · test · build`
- ✅ Require branches to be up to date before merging
- ✅ Do not allow bypassing the above settings (this is the "no exceptions"
  the brief asked for; it applies to you too)

**How you verify it.** Open a PR from any branch; the Checks tab shows the
job. Push a commit that breaks a test; the merge button turns grey with
"Required status check failed". Revert; it turns green.

---

## 4. Observability

Three layers, all in this PR.

**Sentry (`@sentry/nextjs`).** Server, edge and browser runtimes are
initialised from `sentry.server.config.ts`, `sentry.edge.config.ts` and
`src/instrumentation-client.ts`; `src/app/global-error.tsx` reports root
crashes; `next.config.ts` uploads source maps at build time when
`SENTRY_AUTH_TOKEN` is set. With no DSN it is a no-op, so nothing changes
until you configure it. PII is off; URLs are scrubbed of signatures and
tokens before sending.

**Structured logs (`src/lib/observability/log.ts`).** One JSON line per
event with a stable name (`payfast.itn.recorded`, `bets.create.created`,
`claim.submitted`, `auth.callback.exchange_failed` …) and the ids needed to
act on it. Errors are captured to Sentry tagged `money_path`. The following
handlers now log through it instead of `console.*`: PayFast checkout and
ITN, bet creation, result declaration, claim submission and polling, upload
slot issue, auth callback/confirm, the Send Email hook, `requireAdmin`, and
the welcome email.

**Ops alerts (`src/lib/observability/alerts.ts`).** For the events that need
a person within the hour, `alertOps()` sends a Sentry event tagged
`alert=true` at level *fatal* **and** an email through Resend to
`OPS_ALERT_EMAIL` (default `johannes@getluckygolfclub.com`), so the alert
lands even before Sentry is configured. It fires on:

| Event | Meaning |
|---|---|
| `payfast.itn.ledger_write_failed` | PayFast confirmed a payment and we could not record it. The golfer has paid and has no bet. |
| `payfast.itn.admin_client_unavailable` | Service role key missing; no payments can be recorded. |
| `payfast.itn.amount_mismatch` / `unknown_tier` | Money arrived that does not match what we sold. Possible tampering. |
| `payfast.itn.missing_reference` / `unhandled` | A COMPLETE notification we could not match, or an unexpected crash in the handler. |
| `bets.create.ledger_lookup_failed` / `insert_failed` | A paid golfer cannot get their bet. |
| `claim.submit_failed` / `claim.declare_failed` | A hole-in-one claim or result could not be saved. |
| `auth.email_hook.send_failed` | Resend refused an auth email: nobody can sign in. |

**Set-up (~15 minutes).**
1. sentry.io → create project "get-lucky-golf" (platform Next.js). Copy the
   DSN. Create an auth token (Settings → Auth Tokens, scope `project:releases`
   + `org:read`) for source-map upload.
2. Vercel → Environment Variables, Production **and** Preview:
   `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (same value), `SENTRY_ORG`,
   `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `OPS_ALERT_EMAIL`. Redeploy.
3. Sentry → Alerts → Create Alert Rule, four rules, all notifying
   `johannes@getluckygolfclub.com` by email:

   | Rule | Condition |
   |---|---|
   | Payment callback failures | Issue alert: a new issue OR an issue regresses, **when** `money_path` equals `payfast_itn`. Action interval 5 min. |
   | Result / claim submission failures | Same, `money_path` equals `claim` or `bets_create`. |
   | Auth errors above threshold | Metric alert: count of events with tag `money_path:auth` > 10 in 10 minutes (critical), > 5 (warning). |
   | 5xx on a money path | Issue alert: new issue **when** tag `money` equals `true`. This catches the `log.error` calls in every money handler's catch block. |

   Plus one rule on `alert:true` at level fatal, action "send immediately",
   which mirrors the direct email.

**How you verify it.**
- Preview URL → POST to `/api/payments/payfast/notify` with a garbage body.
  The server log shows a `payfast.itn.invalid_signature` JSON line
  (warnings do not alert; that is correct, forged ITNs are noise).
- Temporarily remove `SUPABASE_SERVICE_ROLE_KEY` from Preview, redeploy,
  repeat with a validly-signed sandbox ITN (or run a sandbox payment). Within
  a minute: a Sentry issue `payfast.itn.admin_client_unavailable` and an
  email with subject `[Get Lucky preview] payfast.itn.admin_client_unavailable: …`.
  Put the key back.
- Sentry → Releases shows the commit SHA with source maps attached after the
  next build with `SENTRY_AUTH_TOKEN` set; stack traces show TypeScript
  lines, not minified ones.

---

## 5. Database backups

Confirmed in Batch 0: Point-in-Time Recovery is enabled on the production
project. Retention is whatever the add-on tier says under Supabase → Project
Settings → Add-ons → PITR (7 days on the base tier; the number is shown
there and should be recorded in `ARCHITECTURE.md` in Stage 4). Daily
logical backups also exist on the Pro plan regardless of PITR.

The restore procedure, the tested-against-staging drill, and the verification
script are in [`docs/restore-runbook.md`](./restore-runbook.md). The drill
was **not** executed as part of this PR because it needs the staging project
that step 1 creates; run it once after step 1 and record the date and the
row counts at the bottom of that runbook.

---

## What this does not do

- It does not fix anything from the audit. Every `it.fails` and every
  warning in the CI log is a pointer to Stage 3.
- Sentry and the staging project need the dashboard steps above; the code
  degrades to "nothing happens" without them rather than failing.
- The in-memory rate limiter is still in place and still ineffective
  (AUDIT B.8); Batch 4 replaces it.
