# Batch 2 — Claim integrity

Closes AUDIT.md B.4 (the fraud-surface findings) and B.11 (the fictional
leaderboard), and delivers the audit log that Stage 4 asked for early because
it is cheaper to have from now than to backfill.

## What changed

**Database (migration 007)**
- `bets.expires_at` (not null, default 24 h after creation): the play window.
- `bets.video_sha256`, `video_bytes`, `video_uploaded_at`: computed by the
  server from the object in storage after upload.
- `bets.updated_at/updated_by` and `verifications.updated_at/updated_by`:
  every route sets `updated_by` to the acting user.
- `claim_events`: append-only audit log written by `AFTER INSERT OR UPDATE`
  triggers on `bets` and `verifications`. Each row has the actor
  (`updated_by`, else `auth.uid()`), the database role, a column-level
  `{from, to}` diff, and full before/after JSON. A `BEFORE UPDATE OR DELETE`
  trigger raises on any attempt to change it, and update/delete are revoked
  from every role including `service_role`. Nothing can be read from it
  without the service role.

**One state machine** (`src/lib/claims/state-machine.ts`)
```
bet:  active ─player─▶ miss
      active ─player─▶ claimed ─review─▶ verified ─admin─▶ paid
verification:
      pending | documents_received ─▶ under_review ─▶ approved | rejected
      pending | documents_received ────────────────▶ approved | rejected
```
Every status write is a conditional update (`where status = <from>`), so two
concurrent requests cannot both succeed. Anything not in the table is 409
`INVALID_TRANSITION`; a bet past `expires_at` is 410 `BET_EXPIRED`; a
suspended account is 403 `ACCOUNT_SUSPENDED` on checkout, bet creation,
declaration and claim. A retried declaration is a 200 no-op.

**Routes**
- `PATCH /api/bets/[betId]`: body is `{status: 'miss'|'claimed'}` only;
  `declared_result` and `declared_at` are derived server-side.
- `POST /api/verifications/[betId]`: active → claimed (in window), opens or
  updates the verification; locked after review.
- `POST /api/videos/upload-url`: refuses resolved or expired bets; the server
  picks the object path and writes it to `bets.video_url` before the upload.
  **This fixes the bug where no claim ever had footage attached.**
- New `POST /api/videos/uploaded`: after the upload, the server downloads the
  object, records SHA-256, size and its own timestamp. Write-once.
- `POST /api/videos/verify` (the fake "AI check" with a 2-second sleep) is
  deleted. The confirm screen's "Footage received" chip and the YES button
  now follow the real upload; YES is disabled until the footage is sealed.
- Admin: single and batch review go through `reviewVerification()`; approval
  requires the bet to still be `claimed`. `PATCH /api/admin/bets/[betId]`
  now only confirms a payout (`verified → paid`). Admins can no longer set a
  result or approve a claim by editing the bet directly.
- Admin detail page: an **Evidence Integrity** panel (bet opened, window
  closed, footage sealed at, size, SHA-256, with a red flag when the footage
  was never sealed or was sealed after the window) and an **Audit Trail**
  panel listing `claim_events` for the bet.
- New `GET /api/winners` (public, cached 60 s): paid-out bets only,
  anonymised to "First L.". `/leaderboard` reads it instead of the
  hard-coded fictional winners, and shows an honest empty state.

**Tests**: 203, including an exhaustive transition-table test, and every
`it.fails` from Batches 1–2 in the claims suite is now a plain `it`.

## Apply order

Migration first, then deploy (the opposite of Batch 1): the new code inserts
into columns the migration adds. Nothing in the migration breaks the Batch 1
code, so there is no window of breakage.

1. Run `supabase/migrations/007_claim_integrity.sql` on production (SQL
   editor or `scripts/run-sql.mjs`). The final SELECT lists the new columns.
2. Merge and deploy.
3. Optionally set `BET_WINDOW_HOURS` (1–168) in Vercel; default 24.

## What to test on the preview URL

As a golfer (`golfer01@getlucky.test`):
1. Play, record, watch the confirm screen: the chip reads "Securing footage"
   then "Footage received", and YES only enables after that.
2. Declare a miss. Refresh `/result/miss` (it re-sends the declaration): no
   error. `/history` shows the miss.
3. Play again, declare YES, upload two documents, submit. `/verify` shows
   "Documents received".
4. In the SQL editor on staging: `update bets set expires_at = now() - interval '1 minute' where id = '<an active bet>'`,
   then try to record on it: the app shows the 410 error (Batch 2 does not
   add a dedicated screen; it is an error toast).

As the admin (`seed-admin@getlucky.test`):
5. Open the claim from step 3. The Evidence Integrity panel shows a SHA-256,
   a size and a sealed time inside the window. The Audit Trail lists:
   bet insert, video_url set, video sealed, status active → claimed,
   verification insert.
6. Approve it. The bet shows `verified`; the trail gains two rows with your
   admin id. Try to reject it now: 409.
7. Batch-approve a claim whose bet is `miss` (seeded data has none; make one
   via SQL): the result row says "Cannot approve: the bet is miss".
8. Try, in the SQL editor: `delete from claim_events where id = 1` → error
   "claim_events is append-only". Same for `update`.
9. `/leaderboard` shows "No prizes paid out yet" until a bet is `paid`. Mark
   one paid via `PATCH /api/admin/bets/<id>` (`{"status":"paid"}` from a
   verified bet, e.g. with the browser console `fetch`), reload: the winner
   appears as "First L.".

## Risk that remains

- **Not transactional.** `reviewVerification` updates the verification and
  then the bet in two requests. If the second fails, a verification is
  `approved` while the bet stays `claimed`; the audit trail shows it and the
  next approval attempt reports 409. Stage 4 can move this into one RPC.
- **The hash is computed on the client's say-so timing.** The client calls
  `/api/videos/uploaded` after its upload; if it never does, the footage is
  unsealed and the admin panel flags it in red. Stage 4's storage webhook
  removes the dependency on the client.
- **No location or tee-time binding yet** (Stage 4).
- **The window is 24 h by default.** A golfer who buys the night before a
  morning round is fine; one who buys on Friday for Sunday is not. Change
  `BET_WINDOW_HOURS` if that is wrong for how people actually buy.
- **Existing active bets** get `expires_at = created_at + 24h` from the
  migration, which for anything older than a day is already in the past.
  Check `select count(*) from bets where status = 'active'` before applying
  and decide whether to extend them by hand.
- **`/api/admin/bets/[betId]` had no UI caller** before this batch and still
  has none; marking a bet paid is a console `fetch` until an admin button
  exists (Batch 6).
