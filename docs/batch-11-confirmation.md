# Batch 11 — Independent confirmation

Stage 4, third batch (docs/stage-4-proposal.md §1.2 and §1.7). Until now
every piece of evidence on a claim came from the claimant. This batch asks
the people they named, and the club itself, through a channel the claimant
does not control, and packages everything for the insurer.

## What changed

**Witness requests.** When a claim is submitted, every person named on it
gets an email with one question and one button: "Did you see the ball go
in?" for a playing partner, "Did your club issue that certificate?" for a
club official. The link carries a 32-byte one-time token; only its SHA-256
is stored. It works once and expires after 14 days. The email and the page
say only the golfer's name, the course, the hole and the date.

**The answer page** (`/witness/<token>`, public, rate limited by IP)
records yes or no, an optional note, the time, a hashed IP and the device,
then spends the token. Answers go to the reviewer and the evidence pack;
the golfer never sees them. Spent, expired and unknown links each get a
plain explanation.

**Course contacts.** Admin → Courses → a course now has a Club contacts
list. Every claim at that course adds those people to the claim as club
officials (marked "course contact") and asks them too, independent of
whoever the claimant named. Migration 014 adds `course_contacts` and the
token and response columns on `claim_witnesses`.

**Resubmission keeps answers.** Re-submitting a claim with a changed
witness list keeps the people still on it (with any request already sent
or answer already given), drops the ones removed, adds the new ones, and
never touches course-added rows. Only people not yet asked get an email.

**Admin.** The detail's witness card shows each person's status (not asked,
asked on a date, confirmed, said no with their note, link expired) and a
Send again button that issues a fresh link. The audit trail card gains
Export evidence pack.

**Evidence pack.** One JSON file per claim: the bet and verification rows,
the claimant, the course and hole, the payment ledger rows, the three
objects with their hashes, sizes and 7-day signed URLs, the capture
report, the risk flags, every witness and answer, the review checklist,
notes and payout reference, and the full event log. The response carries
its own SHA-256 in a header, shown in the admin next to the download, so
the copy the insurer receives can be checked with `sha256sum`. Exports are
logged with the hash.

## Apply order

1. Migration 014 on staging, then production.
2. Deploy. No new environment variables: emails go through the existing
   Resend sender; links use `NEXT_PUBLIC_SITE_URL`.
3. Admin → Courses: add a club contact for each partner course. Until a
   course has one, only the claimant's named people are asked.

## What to test on preview

1. Add yourself as a club contact on the test course. Submit a claim
   naming a second address you control as the playing partner. Two emails
   arrive: the partner one asks "did you see it", the club one asks about
   the certificate. The admin detail shows both as "asked".
2. Tap the partner link: the page shows first name, course, hole, date,
   and two buttons. Answer yes with a note. The admin shows Confirmed with
   the note. Open the same link again: "already been answered".
3. Answer the club link with no. The admin shows Said no in red.
4. On the admin detail, Send again for a person who has not answered: a
   new email arrives and the old link says it is not one we sent.
5. Export evidence pack: a JSON downloads and a hash appears. Run
   `sha256sum` on the file; it matches. Open the file: the footage URL
   plays, the witnesses and answers are in it.
6. Resubmit the claim with the partner removed and a new one added: the
   removed person's row is gone, the new person gets an email, the club
   contact's answer is untouched.

## Remaining risk, and what was left alone

- **Email is the channel.** Club inboxes are slow and playing partners
  ignore email. WhatsApp through Twilio would reach more people on the
  day; the table and the token model are channel-agnostic, so adding it is
  a sender, not a redesign. Decided: email first.
- **A witness address is still the claimant's word** until they answer.
  What changes is that a fake address never answers, a friend's address
  answers from a phone the risk rules can see, and the club is asked
  regardless.
- **Sending is inline** in the claim request (one to five emails, roughly
  a second). Batch 12 moves it to the outbox with retries; until then a
  Resend outage means "not asked yet" in the admin and a Send again.
- **Signed URLs in the pack expire in 7 days.** The hashes do not. A pack
  older than that is still verifiable against the objects in storage;
  re-export for fresh links.
