# Batch 8 — POPIA: deletion, retention, the privacy page

Closes AUDIT.md B.10. Before this batch there was no way for a golfer to
delete their account, footage and documents lived forever, and the privacy
page promised a deletion path that did not exist.

## What changed

**Account deletion, self-service.** My account → Delete account. The page
first asks `GET /api/account` whether the account can go and how many
unplayed challenges it would forfeit, shows that in the confirmation, then
calls `DELETE /api/account`. The server (`src/lib/account/delete.ts`):

1. Refuses (409) if the account is suspended, or if any bet is `verified`
   or `paid`, or if any `claimed` bet has a verification that is
   `documents_received`, `under_review` or `approved`. Those records are
   the insurer's or a fraud review's; support closes such accounts by hand.
   A declared win with no documents, or a rejected claim, does not block.
2. Removes every object under `<user id>/` in `shot-videos` and
   `verification-docs`, walking sub-folders. If storage fails, nothing
   else happens and the golfer sees "nothing has been removed; try again".
3. Deletes the auth user. The schema's cascades take the profile, bets and
   verifications with it. `payfast_payments` keeps the money and loses
   the person (`user_id` and `bet_id` set null, as designed in Batch 3).
   `claim_events` is append-only and stays: it holds bet and verification
   rows, never the profile.
4. Logs `account.deleted` with counts. The client signs out and lands on
   the splash page.

Rate limited: five deletions per user per hour, a hundred per IP.

**Retention, automatic.** Migration 011 adds `bets.footage_purged_at` and
`verifications.documents_purged_at`, with partial indexes for the two scans.
`src/lib/retention.ts` runs nightly via `GET /api/cron/retention`
(`vercel.json`, 02:00 UTC), authenticated by the `CRON_SECRET` bearer that
Vercel attaches. The sweep:

- removes the footage of every `miss` declared more than `RETENTION_DAYS`
  ago (default 90, minimum 7) and stamps the bet; `video_sha256` and
  `video_bytes` stay as the record that footage existed;
- removes the certificate, affidavit and footage of every `rejected`
  claim reviewed more than `RETENTION_DAYS` ago and stamps both rows;
- never touches `verified` or `paid` bets;
- handles each row on its own: a failure is counted, logged, and retried
  the next night because the stamp is only written after the object is
  gone. Any failure raises one `retention.partial_failure` ops alert.

Without `CRON_SECRET` the route answers 503 and logs
`retention.misconfigured` rather than run for whoever finds the URL.

**Privacy page** rewritten to say what the code does: what is collected
(including that claim documents carry other people's details), why, who
sees it (team, Indwe, PayFast, and the hosting suppliers by name), how long
each thing is kept, how deletion works and what it keeps, and the
Information Regulator as the complaints route. Effective September 2026.
It has not been read by a lawyer; it is a faithful description, not legal
advice.

**Test harness.** The fake Supabase client gained bucket-aware storage
(`list`, `remove`, `download`), `auth.admin.deleteUser` with the schema's
cascades, and a null-aware `is()` filter. Two new suites,
`account-delete.test.ts` and `retention.test.ts`.

## Apply order

1. Run migration 011 on staging, then production.
2. In Vercel, add `CRON_SECRET` (any long random string; Vercel reads it
   and sends it as the bearer token) for Production and Preview.
   Optionally `RETENTION_DAYS`.
3. Deploy. Vercel picks up the cron from `vercel.json`; check Project →
   Settings → Cron Jobs shows `/api/cron/retention` daily at 02:00 UTC.

## What to test on preview

1. My account → Delete account on a fresh test user with one unplayed
   challenge: the confirmation says one challenge is forfeited; after
   confirming you land on splash, and signing in again with the same
   Google account gives a brand-new profile. In Supabase, the auth user,
   profile and bets are gone; the `payfast_payments` row is still there
   with `user_id` null; the folders under the old user id in both buckets
   are empty.
2. Same on a test user with a claim under review: the confirmation
   explains support must do it, with no delete button. Same for a
   suspended user.
3. Retention. On staging, set an old `declared_at` on a miss that has
   footage, then call the route with the secret:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<preview>/api/cron/retention
   ```

   The response counts one miss and one object; the bet's `video_url` is
   null, `footage_purged_at` is set, and the object is gone from
   `shot-videos`. A call with the wrong token is 401.
4. Read `/privacy` once, as the person who has to stand behind it.

## Remaining risk, and what was left alone

- **Deletion is a fraud reset.** A golfer who is not yet suspended can
  delete and re-register with the same Google account and start clean:
  attempts counter, history, everything. Suspended accounts are blocked,
  but the gap between "looks wrong" and "suspended" is open. Stage 4
  (fraud controls) should record a hashed email of deleted accounts and
  their bet count, so a returning deleter is visible.
- **Old misses are purged in one go.** The first run after deployment will
  purge every miss older than 90 days at once, up to 200 per scan per
  night. That is the intended outcome, but read the first night's
  `retention.run` log line.
- **Vercel Hobby crons** run once a day at best and may drift by up to an
  hour; fine for this.
- **The privacy page** needs a legal read before launch. The 90-day
  figures and the "as long as the insurer requires" line should be
  confirmed with Indwe.
- **Club membership** (`members`) is another system's table and is not
  touched by deletion; the page says so.
- **Support-side deletion** for blocked accounts is manual (Supabase
  dashboard: delete the auth user; then empty the two storage folders by
  hand, or run `deleteAccount` from a script). Stage 4 can add an admin
  action if it comes up more than rarely.
