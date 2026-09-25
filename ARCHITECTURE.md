# Get Lucky Hole-in-One Challenge — how it works

For the developer who joins in six months. Read this, then `README.md` for
how to run it, then the batch notes in `docs/` for why each part looks the
way it does. `AUDIT.md` is what it looked like before any of this.

## 1. In one paragraph

A golfer signs in, proves they are 18, picks a partner course and a par 3,
pays a stake through PayFast's hosted checkout, films their tee shot in the
app, and declares a miss or a hole-in-one. A hole-in-one becomes a claim:
the footage is sealed, the golfer uploads the club's certificate and a
witness affidavit, names the people who saw it, and those people and the
club are asked to confirm by email. An admin reviews all of it against a
checklist, approves or rejects, and after the insurer (Indwe Risk
Services) pays, records the payout reference. Every change to a bet or a
claim is written to an append-only log. Prizes go up to R1 000 000, so the
whole system is built around one question: can we hand an underwriter a
coherent, tamper-evident file for every claim.

**Stack.** Next.js 16 App Router on Vercel Pro; Supabase for Postgres,
Auth, Storage; PayFast hosted checkout and ITN webhook; Resend for email;
Sentry for errors. TypeScript strict, zod on every route, vitest against
an in-memory PostgREST fake.

## 2. The player's path, and what enforces each step

| Step | Route / page | What it does | Enforced by |
|---|---|---|---|
| Sign in | `/auth`, `/auth/callback`, `/auth/confirm` | Google or emailed code via Supabase Auth; `finishSignIn()` marks onboarding, queues the welcome email, sends first-timers to the age gate | Supabase session cookie; `safeNext()` allow-list stops open redirects |
| Age gate | `POST /api/profile/age-check` | Date of birth → `profiles.age_verified_at`, `terms_accepted_at` | Server sets the columns; a client cannot (profile guard trigger, migration 006) |
| Pick a hole | `/select-course`, `/choose-stake` | Partner courses with active par-3 holes; a stake tier | `GET /api/courses` shows partner courses only; checkout re-checks |
| Free swing | `POST /api/bets/free` (card on `/choose-stake`, prompt on `/home`) | The freemium entry: one per account for life, no stake, R10,000 prize, then the ordinary record → claim → review path | `bets_one_free_swing_per_user` (migration 023) and the deterministic `free_<uid>` reference on the existing unique index; age check; suspension check; same target check as checkout; rate limit |
| Pay | `POST /api/payments/payfast` → PayFast | Signs a checkout with our `gl_<uuid>` reference and the user, course, hole and tier inside the signed payload | PayFast credentials come from env with no fallback; production refuses sandbox (`instrumentation.ts`) |
| ITN | `POST /api/payments/payfast/notify` | PayFast tells us it was paid. IP allow-list, signature, phone-home validation, merchant check; a membership reference (`GLG-…`) is handed on to the membership site's webhook; otherwise amount matched to tier, then a row in `payfast_payments` | Upsert on `m_payment_id`, so retries are no-ops; anything unexpected is a 500 so PayFast retries |
| Bet | `POST /api/bets/create` (polled by `/payment-return`) | A bet exists only when the ledger holds a complete payment for this user; course, hole and tier come from the ledger, never the body | Unique `payment_intent_id`; age check; suspension check; rate limit |
| Record | `/record` → `POST /api/videos/upload-url` | Server picks the object path `<uid>/<bet>/shot.*`, issues a signed upload slot, stores the recorder's report (start, end, duration, position, distance to course, device) | Play window (`expires_at`, 24 h); ownership through RLS |
| Seal | `POST /api/videos/uploaded` | Server reads the object back, stores SHA-256, size and its own timestamp | Write-once: the first hash stands |
| Miss | `PATCH /api/bets/[id]` `{status:'miss'}` | `active → miss`, server timestamp | State machine |
| Claim | `POST /api/verifications/[id]` | `active → claimed`, verification opened; documents read back and hashed; witnesses recorded; course contacts attached; hashed IP and device recorded; risk rules run; confirmation emails queued | State machine; paths must be under the caller's folder; documents must exist; a playing partner must be named |
| Confirm | email → `/witness/<token>` | Each named person answers one question through a one-time link | Token hashed at rest, works once, 14 days; IP rate limit |
| Review | `/admin/verification-queue/[id]` | Footage, documents, hashes, recorder report, flags, witnesses, history, event log; checklist to approve; reason to reject | `requireAdmin()` on every admin route; checklist and notes validated server-side |
| Pay | `PATCH /api/admin/bets/[id]` `{status:'paid', payoutReference}` | `verified → paid` with the bank reference | State machine; reference required |
| Delete | `DELETE /api/account` | Storage folders, then the auth user (cascades) | Blocked while a claim is open or the account is suspended |

Everything under `/api/admin` re-checks `profiles.is_admin` with the
service role; the admin layout's client-side gate is cosmetic.

## 3. Data model

All in `public`, defined by `supabase/migrations/001…023`, typed by hand in
`src/types/database.ts` (regenerate after a migration; see README).

| Table | One row per | Notes |
|---|---|---|
| `profiles` | user | Name, handicap, email mirror, age and terms timestamps, `is_admin`, suspension. Server-managed columns are guarded by trigger; changes to them are logged to `account_events`. |
| `courses`, `holes` | course, par-3 hole | `courses.lat/lng` for the distance check; `is_partner` gates checkout. |
| `course_contacts` | club official per course | Asked to confirm the certificate on every claim at the course. |
| `bets` | entry | Status, stake, prize, ledger reference, play window, footage path + hash + size + sealed-at, capture report, hashed IP/device, risk flags and score, payout reference, purge stamp. `tier = 'tier_free'` is the free swing: stake 0, no ledger row, one per user by unique index. |
| `payfast_payments` | payment the ITN accepted | The money ledger. Keeps amounts when a user is deleted (`user_id` nulled). |
| `verifications` | claim | Document paths + hashes, review state, checklist, notes, reviewer, timestamps, purge stamp. One per bet. |
| `claim_witnesses` | person named on a claim | Role, source (claimant or course), token hash, request and response with time, hashed IP, note. |
| `claim_events` | change to a bet or verification | Append-only, trigger-written: actor, role, column diff, before/after. Even the service role cannot update or delete. |
| `account_events` | change to a profile's managed columns | Same pattern. |
| `deleted_accounts` | self-deleted account | Salted email hash, bet and claim counts. |
| `rate_limits` | (rule, scope) counter | Fixed-window, written only by the `rate_limit_hit()` function. |
| `outbox` | background job | Kind, payload, attempts, next attempt, done or failed. |
| `leads`, `members` | marketing lead, club member | Older tables; `members` belongs to the club funnel and is only read (by email) for the badge. |

**Access.** Clients read their own rows through Row Level Security and
write almost nothing: every money-table write goes through a route that
checks ownership with the caller's client, then writes with the service
role. Storage: `shot-videos` and `verification-docs` are owner-folder,
write-once. Three SQL functions (`admin_totals`, `admin_revenue_by_*`) and
`rate_limit_hit` are service-role only. Migration 006 is the lockdown;
`__tests__/staging` probes it as a real user.

## 4. The state machine

`src/lib/claims/state-machine.ts` is the only place a bet or verification
changes status.

```
bets           player:  active → miss | claimed
               review:  claimed → verified        (only via an approved verification)
               admin:   verified → paid           (payout reference required)

verifications  pending → documents_received | under_review | approved | rejected
               documents_received → under_review | approved | rejected
               under_review → approved | rejected
               approved, rejected: terminal
```

Every transition is `update … where id = ? and status = <from>`; zero rows
is a 409, never a silent overwrite. Declaring the same result twice is a
200 no-op. A resubmitted claim updates the same open verification; a
reviewed one is locked. `assertOpen()` enforces the play window;
`assertNotSuspended()` the suspension.

**Idempotency on the money paths.** `payfast_payments.m_payment_id` is
unique and the ITN upserts on it. `bets.payment_intent_id` is unique and
never rewritten, so bet creation for a payment is idempotent. Footage and
documents are write-once (hash stands, bucket policy forbids overwrite).
Witness tokens work once. Outbox handlers are safe to run twice.

## 5. The fraud controls, and why each exists

Nothing here decides a claim. A person does, with more in front of them.

| Control | Where | Why it exists |
|---|---|---|
| Bet only after a verified payment, from the ledger not the body | `bets/create`, ITN | Before this, any POST with an invented reference produced a live bet |
| Play window | `bets.expires_at`, `assertOpen` | A bet could sit active for months and be claimed against footage from any day |
| Server-chosen footage path, server-computed hash, size, timestamp | `upload-url`, `uploaded` | The client used to name the object and could point the admin at any file; substitution was undetectable |
| Capture report and distance to course | `capture.ts`, migration 012 | A substituted clip must now lie consistently about three timestamps, a duration and a place; location is a flag, never a block |
| Document hashes at submission | `documents.ts` | Proves the file reviewed is the file submitted |
| Named witnesses and club contacts, asked directly | `witnesses.ts`, `confirmation.ts`, `course_contacts` | The certificate and affidavit were both self-uploaded; now someone the claimant does not control says yes or no |
| Hashed IP and device at bet and claim | `risk/hash.ts`, migration 013 | The only signal for "one person, many accounts" that does not require a third-party script |
| Eleven risk rules, re-run on every admin open | `risk/rules.ts`, thresholds in `risk/thresholds.ts` | Turns the patterns a careful reviewer would look for into a list they cannot forget to look at |
| Review checklist, reason on reject, reference on paid | admin verification and bet routes | The decision carries what was checked; an underwriter can read it |
| Append-only event logs | `claim_events`, `account_events` | Who did what, when, with before/after; survives the service role |
| Suspension and blocked deletion | `profiles.suspended_at`, `account/delete.ts` | A fraud review cannot be ended by deleting the evidence |
| Deleted-account memory | `deleted_accounts`, `deleted_and_back` rule | Deletion is not a reset |
| Rate limits, Postgres-backed | `rate-limit.ts`, migration 009 | The old in-memory limiter limited nothing on Vercel |
| Evidence pack with its own hash | `evidence-pack/route.ts` | One file per claim the insurer can verify with `sha256sum` |

Retention is the other half of "what we keep": footage of misses and the
documents, footage and witnesses of rejected claims are purged after 90
days (`retention.ts`, nightly). Approved and paid claims are kept.

## 6. Background work and schedules

`vercel.json` schedules two routes, both authenticated by `CRON_SECRET`
(`cron-auth.ts`):

- `/api/cron/outbox`, every minute: drains `outbox`. Jobs today:
  `witness_request`, `welcome_email`. Claim = conditional update on
  `next_attempt_at` (also the 5-minute lease). Backoff 1 m, 5 m, 30 m,
  2 h, 12 h; sixth failure is a dead letter with one ops alert.
- `/api/cron/retention`, 02:00 UTC: the purge, 200 rows per scan, each on
  its own, stamped only after the object is gone.

Ops alerts (`alertOps`) send inline, Sentry plus an email to
`OPS_ALERT_EMAIL`, so an alert about the queue never sits in the queue.

## 7. Observability

`src/lib/observability/log.ts` writes one JSON line per event to stdout
(Vercel logs) and forwards `error` to Sentry with a `money_path` tag.
`apiError()` answers every unhandled failure with a generic message and a
request id that is also on the log line and the Sentry event. `alertOps()`
is for the handful of things that need a person within the hour: ITN
could not be recorded, claim could not be saved, retention partial
failure, dead letter. Alert rules and the Sentry set-up are in
`docs/stage-2-safety-net.md`.

## 8. Environments

Production and staging are separate Supabase projects. Every Vercel
Preview points at staging; `src/instrumentation.ts` refuses to start a
preview that points at production or has PayFast live, and refuses
production in sandbox. Every script under `scripts/` refuses the production
ref. Environment variables are tabled in `README.md`. Three must be picked
once and never rotated casually: `RISK_HASH_SALT` (rotating orphans every
hash), `CRON_SECRET` (rotating pauses both crons until Vercel has the new
one), `SEND_EMAIL_HOOK_SECRET` (the Supabase hook stops delivering codes).

## 9. Runbooks

### A payment happened but there is no bet

1. Vercel logs, filter `payfast.itn`. The ITN either answered 200 (row
   written), 400/403 (rejected: `rejected_ip`, `invalid_signature`,
   `validate_invalid`, `merchant_mismatch`), 500 (`ledger_write_failed`,
   alerted), or never arrived.
2. `rejected_ip`: PayFast added an address. Add it to
   `src/lib/payfast/ips.ts`, deploy; PayFast retries for a while, or ask
   them to resend the ITN from the merchant dashboard.
3. `invalid_signature`: the passphrase in Vercel differs from PayFast's.
4. Row written with `status = 'amount_mismatch'` (alerted): the golfer paid
   an amount that matches no tier. Refund through PayFast or decide the
   tier by hand; no bet is granted automatically.
5. Row is `complete` but no bet: the golfer opens the app, and Home shows
   "Your paid shot is waiting" (from `/api/payments/pending`); tapping it
   finishes the purchase. Or send them
   `/payment-return?ref=<m_payment_id>`, which does the same. Both call
   `/api/bets/create`, which is idempotent.
6. Never insert a bet by hand. Fix the ledger row, let the route make the
   bet, so the event log and idempotency hold.

### A claim is disputed

1. Open it in the admin. Export the evidence pack; note the hash; keep the
   file. Everything the insurer will ask is in it: hashes, recorder
   report, distance, flags, witness answers, the review checklist, the
   full event log with actors and before/after values.
2. The event log answers "who changed what when". A gap in it means the
   row predates migration 007.
3. If the dispute is about the footage: the hash on the bet is the hash
   of the object as sealed; re-hash the object in storage to show it is
   unchanged. If they claim it was swapped before sealing, the recorder
   report, upload lag and bet timestamps are the timeline.
4. If the dispute is about a witness: their answer, time and hashed IP
   are on the row; `witness_overlap` and `shared_ip` say whether that
   person also has an account or appears elsewhere.
5. Rejecting after approval is not a transition. If an approved claim must
   be reversed, suspend the account, do not mark paid, and record why in
   `account_events` via the suspension reason.

### An outbox dead letter

The alert carries the job. Fix the cause (a bad address, Resend down), then
`update outbox set failed_at = null, attempts = 0, next_attempt_at = now()
where id = …` in the SQL editor. The handler is idempotent.

### Retention alerted a partial failure

`retention.*_failed` log lines name the row and the storage error. Usually
an object already gone by hand; the sweep retries nightly and stamps once
`remove` succeeds (a missing object is not an error).

### Someone must close an account support-style

A suspended account, or one with an open or paid claim, cannot delete
itself. After the claim is settled: Supabase dashboard → delete the auth
user (cascades rows), then empty `shot-videos/<uid>` and
`verification-docs/<uid>`, then insert the `deleted_accounts` row by hand
if you want the returning-deleter rule to see them.

### Restore

`docs/restore-runbook.md`. Point-in-time recovery is on; the drill is
`npm run staging:verify-restore`.

## 10. The scaling ceiling

Event day is 120 entries in two hours: one a minute, maybe twenty requests
a second at the peak. Postgres and PostgREST will not notice; the load
test in `scripts/load/event-day.mjs` runs that at 12× and reports where it
degrades (`docs/batch-12-scale.md` has the expected numbers; the measured
ones go there when it has been run).

Where it actually breaks, and the next move:

| Volume | What gives | Next move |
|---|---|---|
| 10× (1 200 entries in two hours) | Nothing. The queue's "most flags" sort resolves all claimed bets in memory, fine below 5 000 claims total | None |
| Sign-ups in a marketing spike | Supabase Auth's email rate limit (default 30/hour) stalls sign-ups before anything else | Raise it (Authentication → Rate Limits) before the push; `docs/batch-12-scale.md` |
| 100× (12 000 entries in two hours, ~2/s) | Sealing downloads each video (up to ~7 MB) into a function; the risk rules run ~12 reads per claim and per admin open; the outbox drains 25 jobs a minute | Stream the hash; move risk evaluation to the outbox; raise the drain limit or add a second cron on offset minutes |
| Beyond | The claimed-bets set past ~5 000 makes the risk sort and the hole-cluster rule scan large; `claim_events` grows without bound | Paginate the risk sort in SQL (a view with the score); partition or archive `claim_events` by year |
| A second product on the same database | Everything shares one Supabase project and one service role key | Separate project, or at least separate schemas and roles |

The architecture's real ceiling is not throughput. It is that one Vercel
function does everything, one service role key can do anything, and there
is no queue for work that talks to third parties other than email. Those
are the day-one decisions to revisit if the product outgrows one course
on one Saturday.

## 11. Known limitations

- A recorder report comes from the phone. It can be fabricated by someone
  who controls the device; what it cannot easily be is consistent with
  the server's timestamps and the footage.
- Nothing proves the bytes came from the in-app recorder. A native app
  with attested capture would; this is a web app.
- Email is the confirmation channel. Playing partners ignore email; the
  club may take days. WhatsApp through Twilio is a sender away.
- Batch approve exists and bypasses the review checklist; the record shows
  when it was used. The decision to keep it was the owner's.
- Second sign-off on a payout is outside the app.
- `shared_ip` fires on club Wi-Fi. It is a flag, paired with the device
  rule, never a block.
- Thresholds in `risk/thresholds.ts` are starting values, not measured.
- The privacy page has not had a legal read. Retention periods should be
  confirmed with Indwe.
- The database types file is hand-maintained until it is generated from
  the Supabase CLI. A column added by migration without updating it
  compiles fine and fails at runtime.
- The admin panel's five list pages set loading state in effects; the
  React Compiler rule that flags it is downgraded to a warning.
- No penetration test has been done. Before meaningful payout volume, get
  one against the claim and payment paths.

## 12. Working on it

- `npm run typecheck && npm run lint && npm test && npm run build` is what
  CI runs. `npm run test:staging` probes RLS as a real user against staging.
- Route handlers: authenticate → rate limit → validate (zod via
  `parseBody`/`parseQuery`) → check ownership with the caller's client →
  write with the service role → `apiError()` on anything unexpected.
- Tests live in `__tests__/money`; `__tests__/helpers/fake-supabase.ts` is
  the in-memory PostgREST look-alike (tables, filters, storage, auth
  admin). If a route needs a filter the fake lacks, add it to the fake.
- A migration checklist: write `supabase/migrations/NNN_*.sql`
  idempotent; apply to staging (`npm run staging:bootstrap`); update
  `src/types/database.ts`; extend the seed if the table matters; add the
  read to `scripts/staging/explain.mjs` if it is hot; note the apply order
  in the batch doc; apply to production before deploying code that needs
  it.
- Never point a script at the production ref. Every script checks; keep
  it that way.
