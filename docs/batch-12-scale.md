# Batch 12 — Scale

Stage 4, fourth batch (docs/stage-4-proposal.md §2). The outbox, the load
test, the auth limits that stall a launch, and the query timings.

## What changed

**Outbox.** Migration 015 adds `outbox`. `src/lib/outbox.ts` has one
`enqueue()` and one `drainOutbox()`. Two job kinds today: `witness_request`
(the confirmation emails, previously sent inline in the claim request) and
`welcome_email` (previously awaited in sign-in completion, now queued; sent
inline only if the queue itself cannot be written). `/api/cron/outbox`
drains due jobs every minute (`vercel.json`; needs Vercel Pro, which you
have). Claiming a job is a conditional update on `next_attempt_at` that
doubles as a five-minute lease, so a runner that dies leaves the job to be
retried. Failures back off 1 min, 5, 30, 2 h, 12 h; after the sixth
attempt the job is a dead letter and ops get one alert with the payload.
Handlers are idempotent: `sendWitnessRequests` skips people already asked.
Ops alerts do not go through the outbox.

The cron bearer check is now shared (`src/lib/cron-auth.ts`) by both cron
routes.

**Load test.** `npm run load:event-day` (`scripts/load/event-day.mjs`).
Against a preview deployment pointed at staging, 120 golfers each sign in
(cookies exactly as `@supabase/ssr` writes them), buy an entry, get the
ledger row the ITN would write (written directly with the service role),
create the bet, get an upload slot with a capture report, PUT 2 MB of
footage, seal it, and declare a miss; every tenth golfer uploads two
documents and submits a claim with a witness (`delivered@resend.dev`).
An admin pages the queue by risk, loads the dashboard and opens a claim
every five seconds throughout. Ten minutes by default, so 12× the real
rate. It prints p50, p95, max and error counts per step and writes
`scripts/load/load-report.json`. `--cleanup` deletes the load accounts
through the app's own deletion path (which exercises that too). It refuses
to run against production.

**Timings.** `scripts/staging/explain.mjs` now also runs the Stage 4 reads:
queue by risk, the three risk-rule scans, the two retention scans, witness
lookup by claim and by token, the outbox scan, the deleted-account lookup.

## Apply order

1. Migration 015 on staging, then production.
2. Deploy. `CRON_SECRET` is already set from Batch 8. Check Project →
   Settings → Cron Jobs shows both `/api/cron/outbox` (every minute) and
   `/api/cron/retention`.
3. Supabase → Authentication → Rate Limits (both projects), before any
   marketing push:
   - "Rate limit for sending emails": the default is 30 an hour, which is
     30 sign-ups an hour. Set it to at least 500. Emails go through the
     Send Email hook to Resend, so this is Supabase's counter only.
   - "Rate limit for token refreshes" and "sign-ins": leave the defaults
     unless the load test says otherwise; they are per IP and generous.
   - Confirm the Resend domain's sending quota covers 500 an hour.

## The load test: what to run and what I expect

```bash
BASE_URL=https://<preview>.vercel.app \
STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co \
STAGING_SUPABASE_ANON_KEY=… \
STAGING_SUPABASE_SERVICE_ROLE_KEY=… \
npm run load:event-day -- --cleanup
```

Then paste the table into this document under "Results", and run
`scripts/staging/explain.mjs` once more for the timings under Batch 6.

What I expect, and what to do if it shows:

| Step | Expected p95 | If worse |
|---|---|---|
| `checkout` | under 800 ms | It does four reads and a signature; nothing to fix unless the rate limiter RPC is slow, in which case the `rate_limits` table needs `vacuum` |
| `bet_create` | under 800 ms, some 202s | 202s are the script beating its own ledger write; harmless |
| `video_put` | 1–3 s for 2 MB | Network from the load machine, not the app |
| `video_seal` | 1–2 s | The server downloads the object to hash it. If p95 passes 5 s at 7 MB real footage, hash in chunks with a stream (`blob.stream()`), same function |
| `claim_submit` | under 1.5 s | Two document downloads and the risk rules (~12 reads). If p95 passes 3 s, the risk evaluation moves to the outbox |
| `admin_detail` | under 1.5 s | Re-evaluates the rules on every open. Same fix as above |
| `admin_stats` | under 500 ms | SQL aggregates; if slow, the `bets` table needs the Batch 6 indexes applied |
| `admin_queue` (risk sort) | under 500 ms | Resolves up to 5 000 claimed bets first; fine below that; past it, paginate in SQL |

Errors of any kind other than 202 on `bet_create` are findings.

## Results

_Not run yet._

**Attempt of 2026-09-15 (cloud session, environment "Get Lucky").** Not
run, and nothing was written anywhere. The key check found that all four
`STAGING_*` variables in the handover environment resolved to the
production project: the ref inside `STAGING_SUPABASE_URL`, the `ref` claim
inside both JWTs and `STAGING_PROJECT_REF` itself were all the production
ref, so the seed, the bootstrap and this test all refused (as they
should). `BASE_URL` also lacked its `https://` scheme, and no Supabase,
Vercel or Sentry API token reached the session. The preview that `BASE_URL`
named (deployment `dpl_DvGsQ3mzqX5X7SBBRjQAByTU4iRX`, the merge of #23)
answered 200 once the scheme was added. Redo parts 4 (variables) and 5
(credentials) of the handover with the staging project's URL and keys, then
run the block above or the manual workflow in
`.github/workflows/load-test.yml`, and paste the table here.

## Remaining risk, and what was left alone

- **A minute of latency** on welcome and witness emails, by design. If a
  golfer expects the witness to have the email before they leave the tee,
  the claim page can say "within a minute".
- **One runner at a time is the assumption.** The lease makes overlap safe
  but not efficient; if the queue ever needs more than 25 jobs a minute,
  raise the limit or run two crons on offset minutes.
- **The dead-letter alert carries the payload** (a bet id, an email). It
  goes to the ops inbox only.
- **The load test is not a browser.** It does not measure page render or
  the client-side upload progress; it measures the API and storage paths,
  which is where the money moves.
