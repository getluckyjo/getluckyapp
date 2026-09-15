# Stage 4 — Proposal: fraud controls and scale hardening

The brief says design before implementing. This is the design. Nothing in
it is built yet. Each section names what Stage 3 already put in place, the
gap that remains, what is proposed, and which batch carries it. Decisions
that are yours, not mine, are marked **Decision**.

The framing that runs through all of it: the volume is low and every claim
is worth a lot, so the controls are about making a false claim *expensive
to construct* and *easy to see*, and about being able to hand an
underwriter a coherent evidence file. Nothing here auto-pays, and nothing
here replaces a person watching the footage.

---

## 1. Fraud: the layered scheme

### 1.1 Server-authoritative results

**Have.** The state machine (`src/lib/claims/state-machine.ts`) is the
only writer. A player can move a bet `active → miss` or `active →
claimed`; only the review path moves `claimed → verified`; only an admin
moves `verified → paid`. `declared_result` and `declared_at` are derived
on the server. Every transition is conditional on the current status, so
a replay is a 409, and every row change lands in `claim_events`.

**Gap.** None material. The client cannot assert a win; it can only ask
for a review.

**Proposed.** Keep. Add one guard: `paid` requires `payout_initiated_at`
and a `payout_reference` (the bank or PayFast payout reference), so "paid"
is never a bare status. Batch 10.

### 1.2 Verification evidence, and making it tamper-evident

**Have.** Footage goes browser → storage under `<uid>/<bet>/shot.*` via a
signed URL the server chose; after upload the server reads the object back
and records SHA-256, size and its own timestamp (write-once). Documents
are uploaded to a folder only the owner can write, with no overwrite. Every
change to a bet or verification is in an append-only log with before/after
values and the actor.

**Gap.** Three things an underwriter will still ask about:

1. *Was the footage recorded then and there?* The signed URL accepts any
   file. A clip recorded last week uploads the same way as one recorded a
   minute ago. We record when it arrived, not when it was captured, and
   nothing says where.
2. *Do the documents say what they said on the day?* They cannot be
   overwritten, but we do not hash them, so we cannot prove to a third
   party that the file in storage is the file that was reviewed.
3. *Did anyone other than the claimant confirm it?* The certificate and
   affidavit are both uploaded by the claimant. Nobody independent has
   said "yes" through a channel the claimant does not control.

**Proposed.**

- **Capture attestation (Batch 9).** The record page already knows when
  recording started and stopped. It sends `recordingStartedAt`,
  `recordingEndedAt`, `durationMs` and the device's user agent with the
  upload-url request; the server stores them on the bet along with the
  gap between recording end and upload completion. A gap over a few
  minutes is a flag (section 1.5), not a block: the app deliberately
  uploads in the background and a poor signal on a course is normal.
  This does not *prove* the bytes came from the in-app recorder (nothing
  short of a native app with attested capture does), but it makes a
  substituted clip have to lie consistently about three timestamps and
  a duration, and the review checklist (1.6) asks the reviewer to compare
  them to the footage.
- **Geolocation at capture (Batch 9).** The record page asks for location
  once, at the moment recording starts, and sends lat/lng/accuracy with
  the upload-url request. The server stores it and computes the distance
  to the course (`courses.lat/lng`, already present for most courses;
  the admin course form gets the two fields). Missing or far away is a
  flag, not a block.
  **Decision:** flag-only (recommended) or require location to claim?
  Requiring it blocks honest golfers who tap "don't allow" and gives a
  fraudster a clean story ("my phone doesn't do location"); flagging it
  makes a missing location one more thing the reviewer weighs.
- **Document hashes (Batch 9).** On claim submission the server reads
  the certificate and affidavit back from storage (as it does for
  footage) and stores SHA-256 and size on the verification row. Cheap,
  and it closes gap 2.
- **Witness details captured (Batch 9), witness confirmation (Batch 11).**
  The claim form asks for the witnesses' names and either an email or a
  mobile number, and the club contact who signed the certificate. Batch 9
  stores them (`claim_witnesses`). Batch 11 emails each witness a
  one-time link to a page that asks one question, "Did you see this
  shot go in?", and records the answer, the time, and a hashed IP. A
  partner course gets a standing `course_contacts` record so the
  certificate can be confirmed by the club independently of the
  claimant's upload. Confirmations appear on the admin detail; the
  review checklist asks whether at least one independent confirmation is
  present. **Decision:** email links (recommended: cheapest, auditable) or
  WhatsApp via Twilio (better reach on a course, a new supplier and a
  cost per message; can follow later using the same table).

### 1.3 Entry binding

**Have.** A bet exists only when the PayFast ledger holds a
signature-checked, phoned-home, amount-matched payment for that user,
course, hole and tier. It has a 24-hour play window (`expires_at`); after
that it cannot be resolved, claimed or have footage attached. Every claim
route checks ownership through RLS before writing with the service role.

**Gap.** The window binds *when* loosely and *where* not at all.

**Proposed.** Geolocation (1.2) is the "where". For "when", no tee-time
booking is proposed: the app has no booking integration, and asking a
golfer to type a tee time is a field they will get wrong. The window stays
at 24 hours by default (`BET_WINDOW_HOURS`); the capture attestation plus
`created_at → video_uploaded_at` lag give the reviewer the timeline.
**Decision:** keep 24 hours, or shorten to 12? Shorter is tighter binding
and more support tickets from golfers who bought the night before.

### 1.4 Duplicate and replay protection

**Have.** `payfast_payments.m_payment_id` is unique and the ITN upserts on
it. `bets.payment_intent_id` is unique and never rewritten, so bet
creation is idempotent per payment. Footage and documents are write-once.
Transitions are conditional. A rejected claim cannot be resubmitted; a
verified or paid bet cannot be re-claimed. Result declaration is an
idempotent retry.

**Gap.** Checkout has no idempotency key: a double tap creates two PayFast
references. Only the paid one ever becomes a bet, so this costs nothing
but ledger noise. Duplicate *footage* across bets is not detected.

**Proposed.** Leave checkout. Add "same `video_sha256` as another bet" and
"same document hash as another claim" as flags (1.5). Batch 10.

### 1.5 Velocity and anomaly rules

**Have.** Rate limits on checkout, bet creation, claims, uploads, age
checks and account deletion. No signals are recorded and no pattern is
surfaced to the reviewer.

**Proposed (Batch 10).** Record two signals we do not have today, both as
salted hashes so they are useful for clustering and useless as PII: the IP
at bet creation and at claim (`ip_hash`), and the user agent at claim
(`ua_hash`). Retained with the bet; the privacy page's "technical" line
already covers it.

Then a rule set, evaluated on the server when a claim is submitted and
re-evaluated when an admin opens it, written to `claim_flags` (one row per
rule hit, with the evidence, append-only). The queue shows a count and the
detail shows the rows. No rule blocks; they order the queue and inform the
reviewer.

| Rule | Fires when | Why |
|---|---|---|
| `repeat_claimant` | This account has another `claimed`/`verified`/`paid` bet in the last 365 days, or any rejected claim | One hole-in-one is luck; two is a story that needs checking |
| `first_bet_win` | This is the account's first bet, or the account is under 48 hours old | Fresh accounts are how a scheme starts |
| `shared_ip` | Another account created a bet or claimed from the same `ip_hash` in the last 30 days | One person, many accounts |
| `shared_device` | Same `ua_hash` and `ip_hash` as another account's claim | Same, stronger |
| `upload_lag` | Footage arrived more than 15 minutes after recording ended, or more than 12 hours after the bet was created | Room for substitution |
| `no_location` / `far_from_course` | Location missing, or more than 2 km from the course | Was it recorded there |
| `duplicate_media` | `video_sha256` or a document hash matches another bet | Reused evidence |
| `witness_overlap` | A witness email or number belongs to an account, or appears on another claim | Friends signing for each other |
| `hole_cluster` | Three or more claims at the same hole within 7 days | A hole that suddenly pays out is worth a phone call |
| `deleted_and_back` | The account's email hash matches a deleted account that had bets (closes the Batch 8 risk) | Deletion as a reset |

Thresholds live in one file so they can be tuned without touching the
rules. **Decision:** the thresholds above are starting values; you know
the game better than I do.

### 1.6 Manual review and approval before payout

**Have.** A queue, a detail view with footage, documents, the golfer's
history, the event log; approve/reject/under-review; a separate "record
payout" step to `paid`. Also a **batch approve** of up to 50 claims with
one note, from Stage 0.

**Gap.** Batch approval contradicts "a human on every claim". Approval
records a decision but not what the reviewer checked. One admin can
approve and pay.

**Proposed (Batch 10).**

- Remove batch approve and batch reject. Keep batch "move to under
  review" (it is triage, not a decision). **Decision:** agreed?
- A **review checklist** the approve button requires, stored on the
  verification and therefore in the audit log: footage watched to the
  end; ball seen entering the hole; hole and course match the bet; the
  timeline (capture, upload, bet) makes sense; certificate confirmed with
  the club (how, by whom); affidavit names match the witnesses; flags
  read and each one either explained in notes or accepted. Approval
  without every box is a 400. Rejection requires a reason.
- **Two people on a payout.** The admin who marks `paid` cannot be the
  one who approved, enforced in the state machine, switched on by an
  environment flag once there is a second admin. **Decision:** who the
  second person is, and whether Indwe wants a sign-off step of their own
  before payout (if so, that is a third status, `insurer_confirmed`,
  between `verified` and `paid`, and I would add it now rather than
  later).

### 1.7 Immutable audit log

**Have.** `claim_events`: every insert and update on bets and
verifications, actor, role, before/after, column diff; append-only even
for the service role; shown on the admin detail.

**Gap.** Admin actions on *accounts* (suspend, unsuspend, admin flag) are
in the server logs, not the database. There is no way to hand the log to
someone outside.

**Proposed.** The same trigger pattern for the server-managed profile
columns (`account_events`), Batch 10. An **evidence pack** export per
claim, Batch 11: one JSON file with the bet, the verification, the event
log, the flags, the witness confirmations, the hashes, and time-limited
signed URLs for the objects, plus a SHA-256 of the file itself printed in
the admin UI so the copy Indwe receives can be checked against ours.

---

## 2. Scale hardening

**Indexes.** Added in migration 010 (six indexes on bets, verifications,
holes and profile email), with the retention partial indexes in 011. The
timings are still owed: `scripts/staging/explain.mjs` runs the ten reads
before and after; they go into `docs/batch-6-admin-queries.md`. I need the
two runs from you, or `STAGING_DATABASE_URL` to run them.

**Background jobs (Batch 12).** Today the only synchronous side work is the
welcome email (awaited in sign-in completion, failure tolerated) and the
ops alert email. Batch 11 adds witness emails. Proposed: an `outbox`
table (kind, payload, attempts, next_attempt_at, done_at) and a cron
route that drains it with retries and backoff. Senders enqueue; nothing
in a request waits on Resend. Ops alerts keep sending inline as well,
because an alert about the outbox being stuck must not sit in the outbox.
**Decision:** Vercel plan. Pro crons can run every minute; Hobby crons
run once a day, which is useless for an outbox, in which case the drain
runs at the end of the request that enqueued (`after()` in Next 16) with
the cron as the retry sweep.

**Rate limiting.** In place on entry creation, result submission, claims,
uploads, checkout, age check, deletion, and (by IP) the auth confirm
route. Sign-in itself is Supabase's: its default email rate limit is 30 an
hour project-wide and will stall a launch. Batch 12 documents the settings
to raise (Auth → Rate Limits) and a smoke check that they were.

**Load test (Batch 12).** A script, `scripts/load/event-day.mjs`, run
against a preview deployment pointed at staging: 120 seeded golfers over a
compressed window (the two hours squeezed into ten minutes, so 12× the
real rate), each doing checkout → ledger row (written directly with the
service role, standing in for PayFast) → bet → upload-url → 2 MB upload →
seal → declare; ten percent claim with documents; an admin session
paging the queue and opening details throughout. Reports p50/p95/max and
error rate per step. Expected to degrade first at the upload seal (a
2 MB read per claim on a serverless function) and the admin detail (six
reads); those get fixed in the same batch and the test re-run. You run it
(I have no preview URL or staging keys); the report goes into the batch
doc.

**Scaling ceiling.** Goes into `ARCHITECTURE.md`, with numbers from the
load test rather than estimates.

---

## 3. Batches, in order

| Batch | Contents | Schema | New UX |
|---|---|---|---|
| 9 — Evidence capture | Capture attestation, geolocation, document hashes, witness details on the claim form, course coordinates in admin | `bets`: capture_* columns; `verifications`: *_sha256, *_bytes; `claim_witnesses` | Location prompt on record; witness fields on claim |
| 10 — Risk and review | ip/ua hashes, `claim_flags` and rules, queue ordering by flags, review checklist, batch approve removed, second approver flag, `account_events`, deleted-account memory, payout reference | `bets`: ip_hash, ua_hash; `claim_flags`; `account_events`; `deleted_accounts`; `verifications.review_checklist` | Admin only |
| 11 — Independent confirmation | Witness confirmation emails and page, `course_contacts`, evidence pack export | `claim_witnesses` gains response columns; `course_contacts` | Public witness page; admin export |
| 12 — Scale | Outbox and cron drain, load test script and run, fixes it finds, auth rate-limit notes, timings | `outbox` | None |
| — | `ARCHITECTURE.md` | | |

Same rules as Stage 3: one batch per PR, tests first, a summary with
what to test on preview, and I stop for sign-off between batches. Every
schema addition above is additive (new tables and nullable columns);
nothing existing is restructured.

## 4. What I am not proposing, and why

- **Computer-vision verification.** Human review with a good evidence
  file is the control; automation would be a later optimisation and is
  not what an underwriter asks about.
- **Identity verification (ID number, selfie).** Heavy for the golfer,
  a new PII class under POPIA, and it does not stop a real person making
  a false claim; the witness and club confirmation do more for less.
- **Device fingerprinting libraries.** A hashed user agent and IP give
  the clustering signal without a third-party script on the page.
- **Blocking on any single rule.** Every rule has an innocent
  explanation. The queue exists so a person hears it.

## 5. Decisions needed before Batch 9

1. Location: flag-only (recommended) or required.
2. Witness confirmation channel: email (recommended) or WhatsApp.
3. Play window: keep 24 hours (recommended) or shorten.
4. Remove batch approve and reject (recommended).
5. Second approver on payout, and whether Indwe wants their own step.
6. Vercel plan (Hobby or Pro), which sets how the outbox drains.
7. Any threshold in 1.5 you want changed before it ships.
