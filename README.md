# Get Lucky Hole-in-One Challenge

The app behind [getluckyholeinone.com](https://www.getluckyholeinone.com):
golfers pay to enter a hole-in-one challenge on a par 3 at a partner course,
film the shot, and if it goes in, a prize underwritten by Indwe Risk
Services is paid after review.

Next.js 16 (App Router) · TypeScript · Supabase (Auth, Postgres, Storage) ·
PayFast · Resend · Sentry · Vercel.

## Where to look

| Question | Read |
|---|---|
| How the system works, the data model, the fraud controls, the runbooks | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| What the audit found before any of this was built | [`AUDIT.md`](./AUDIT.md) |
| The safety net: staging, tests, CI, alerts, backups | [`docs/stage-2-safety-net.md`](./docs/stage-2-safety-net.md), [`docs/restore-runbook.md`](./docs/restore-runbook.md) |
| What each remediation batch changed and how to test it | `docs/batch-*.md` |
| Going live with PayFast | [`docs/payfast-go-live.md`](./docs/payfast-go-live.md) |
| Promo codes (an extra free swing per code) | [`docs/promo-codes.md`](./docs/promo-codes.md) |
| Sign-in and the branded auth email | [`docs/auth-email-setup.md`](./docs/auth-email-setup.md) |
| Design tokens and screen comps | [`design/`](./design/) |

## Running it

```bash
npm ci
cp .env.example .env.local      # then fill in the values (see below)
npm run dev
```

Checks, the same ones CI runs on every pull request:

```bash
npm run typecheck     # tsc --noEmit
npm run lint
npm test              # vitest: route handlers against an in-memory Supabase fake
npm run build
```

Against a staging Supabase project (needs the `STAGING_*` variables). There
is no staging project at present (`docs/launch-checklist.md`, decisions),
so these are not run; they stay because every one of them refuses the
production ref, which is the safe default if one is created later:

```bash
npm run staging:bootstrap    # apply supabase/migrations/*.sql, idempotent
npm run staging:seed         # fake users, bets, claims, documents
npm run test:staging         # Row Level Security probed as a real user
npm run load:event-day       # 120 golfers in 10 minutes against a preview URL (BASE_URL=…), see docs/batch-12-scale.md
```

`staging:bootstrap`, `scripts/staging/explain.mjs` and `staging:verify-restore`
connect with `STAGING_DATABASE_URL`. Where raw Postgres is unreachable, the
first two accept `STAGING_PROJECT_REF` instead and send each statement
through the Supabase management API (`scripts/staging/db.mjs` explains where
the access token comes from). Every one of them refuses the production ref.

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | public by design |
| `SUPABASE_SERVICE_ROLE_KEY` | server | every write to money tables goes through it, after an ownership check |
| `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE` | server | no built-in fallback; previews need a sandbox merchant of their own |
| `PAYFAST_SANDBOX` | server | `false` in production, and production refuses to start otherwise |
| `NEXT_PUBLIC_SITE_URL` | all | required in production |
| `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `SEND_EMAIL_HOOK_SECRET` | server | auth emails go through the Supabase Send Email hook |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | all | source maps upload when the token is set |
| `OPS_ALERT_EMAIL` | server | where money-path alerts are emailed |
| `BET_WINDOW_HOURS` | server | play window after purchase, default 24 |
| `CRON_SECRET` | server | Vercel sends it as the bearer token to `/api/cron/outbox` (every minute) and `/api/cron/retention` (nightly); both refuse to run without it |
| `RISK_HASH_SALT` | server | at least 16 random characters; salts the hashed IP, device and email used by the risk rules. Without it those rules stay quiet and the log says so once |
| `BETA_GATE` | server | `on` closes the app to the testers listed at `/admin/beta` (emails or invite codes; migration 016). Unset or anything else: open. Sign-in, marketing, legal and the PayFast return stay reachable either way |
| `NEXT_PUBLIC_BUILD_DATE` | build | set by `next.config.ts` at build time; shown on the Account screen as the build stamp with the commit SHA |
| `NEXT_PUBLIC_FEEDBACK` | build | `on` shows the floating feedback button on every screen (closed-beta use). Unset: no button; the `/api/feedback` route still exists |
| `RETENTION_DAYS` | server | footage of misses and documents of rejected claims are purged after this many days, default 90 |

A preview deployment refuses to start if it points at the production database
or has PayFast in live mode (`src/instrumentation.ts`).

## Layout

```
src/app/(play)/         the play flow: select course → stake → PayFast → record → declare → claim
src/app/(admin)/        the admin panel (client-side gate; every /api/admin route re-checks)
src/app/(dashboard)/    home, winners, my bets, account, and icons (Back an Icon, docs/icons.md)
src/app/api/            route handlers; each validates with zod and fails through apiError()
src/lib/claims/         the claim state machine: the only place a bet or claim changes status
src/lib/payfast/        PayFast configuration and address list
src/lib/rate-limit.ts   Postgres-backed limiter
src/lib/account/        account deletion: what goes, what stays, what blocks it
src/lib/risk/           the velocity and anomaly rules, thresholds, hashing
src/lib/outbox.ts       background jobs (emails), drained every minute by /api/cron/outbox
src/lib/claims/         also: capture attestation, document sealing, witnesses, confirmation tokens
src/lib/retention.ts    the nightly purge of footage and documents (vercel.json schedules it)
src/lib/observability/  structured log + ops alerts (Sentry + email)
src/lib/api/http.ts     parseBody / parseQuery / apiError
supabase/migrations/    numbered, idempotent; apply in order (see each batch doc for timing)
__tests__/              vitest; helpers/fake-supabase.ts is the in-memory PostgREST look-alike
scripts/staging/        bootstrap, seed, verify-restore, explain (query timings)
scripts/load/           the event-day load test
```

## Database types

`src/types/database.ts` types all three Supabase clients. After a migration:

```bash
npx supabase gen types typescript --project-id <ref> --schema public > src/types/database.ts
```

and keep the hand-maintained `members` block at the bottom (the membership
funnel's table, not defined here).
