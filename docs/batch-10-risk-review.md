# Batch 10 — Risk signals and review discipline

Stage 4, second batch (docs/stage-4-proposal.md §1.5–1.7, §1.1). The
reviewer now sees the patterns around a claim, has to say what they
checked before approving and why when rejecting, and "paid" carries the
payment's reference. Nothing here decides anything; a person still does.

## What changed

**Signals recorded.** A salted hash of the IP at bet creation and at claim,
and of the device (user agent) at claim, on the bet. Salt is
`RISK_HASH_SALT`; without it nothing is hashed, the columns stay null, and
the log says so once. Useful for "same person, many accounts", useless as
PII: the privacy page says so.

**Rules.** `src/lib/risk/rules.ts`, thresholds in `thresholds.ts`, labels
in `labels.ts`. Evaluated when a claim is submitted and again every time
an admin opens it; written to the bet as `risk_flags` and `risk_score`
(high 3, medium 2, low 1). Flags are rewritten only when they change, so
the audit log records each change without noise.

| Rule | Severity | Fires when |
|---|---|---|
| `repeat_claimant` | high | Another claim by this account in 365 days, or any rejected claim |
| `first_bet_win` | medium | First bet, or account under 48 h old at the time of the bet |
| `shared_ip` | high | Another account placed or claimed from the same address in 30 days |
| `shared_device` | high | Same device and address as another account's claim |
| `upload_lag` | medium | Sealed more than 15 min after recording ended, or 12 h after the bet |
| `no_location` | low | No position shared |
| `far_from_course` | high | More than 2 km from the course |
| `duplicate_media` | high | Footage or a document hash matches another claim |
| `witness_overlap` | high | A witness holds an account, or appears on another claim |
| `hole_cluster` | medium | Three or more claims at the hole in 7 days |
| `deleted_and_back` | high | A deleted account had this email |

**Queue and detail.** The queue has a Flags column and a "Most flags" sort.
The detail has a Risk Flags card: label, what fired, why it matters. The
card border turns red at a score of 6.

**Review discipline.**
- Approving needs the seven-item checklist (footage watched, ball seen
  entering, hole matches, timeline consistent, certificate confirmed with
  the club, affidavit matches the witnesses, every flag addressed) and
  notes of at least 10 characters. Stored on the verification as
  `review_checklist` with who and when, so it is in the audit log.
- Rejecting needs notes of at least 10 characters: the reason.
- Batch approve and reject stay (your call). Batch reject needs a reason;
  batch approve records `{batch: true}` in place of the checklist, so the
  record shows no per-claim checklist was done.
- Confirming a payout needs the bank or PayFast reference, stored on the
  bet, and stamps `payout_initiated_at` on the verification.

**Account events.** Suspending, unsuspending or changing the admin flag on
a profile writes an append-only `account_events` row with the acting
admin, through a trigger like `claim_events`. The suspension route now
sets `profiles.updated_by`.

**Deleted-account memory.** Account deletion writes the salted email hash
and the bet and claim counts to `deleted_accounts`. No name, no id. The
`deleted_and_back` rule reads it. Closes the Batch 8 risk.

## Apply order

1. Migration 013 on staging, then production.
2. In Vercel add `RISK_HASH_SALT` (at least 16 random characters; the same
   value for Production, a different one for Preview) and redeploy.
   Changing the salt later orphans every existing hash, so pick it once.
3. Deploy.

## What to test on preview

1. Submit a claim from a new test account with location declined. Open it
   in the admin: `first_bet_win` and `no_location` are listed with a score
   of 3, and the queue shows 2 in the Flags column.
2. Submit a second claim from a different account on the same phone and
   network. Open it: `shared_ip` and `shared_device` appear.
3. Approve: with a box unticked the button says "Complete the checklist
   first"; with fewer than 10 characters of notes it says so; with all
   ticked and a note it approves, and the audit trail shows the checklist
   change on the verification.
4. Reject a claim with empty notes: refused. With a reason: rejected.
5. Confirm a payout with no reference: refused. With one: the detail shows
   the reference under the notes.
6. Suspend a user, then check `account_events` in Supabase: one row with
   your admin id.
7. Delete a test account, sign up again with the same email, claim: the
   claim shows `deleted_and_back`.

## Remaining risk, and what was left alone

- **Thresholds are guesses** until there is data. Every one is in
  `thresholds.ts` with the rule it serves.
- **Batch approve** still bypasses the checklist. The record shows it did.
- **Shared IP is noisy on a course**: club Wi-Fi puts every golfer on one
  address. That is why it is a flag, not a block, and why it is paired
  with the device rule.
- **Second approver on payout** is handled outside the app, as decided.
- **Email hashes** in `deleted_accounts` use the same salt as the rest; if
  the salt is ever rotated, the memory is lost. Documented above.
