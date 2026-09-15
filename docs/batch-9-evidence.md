# Batch 9 — Evidence capture

Stage 4, first batch (docs/stage-4-proposal.md §1.2 and §1.3). Everything a
reviewer could not see before about *when* and *where* footage was made,
*whether* the documents are the ones submitted, and *who* the claimant says
saw it. Nothing here blocks a claim; it all lands in front of the person
reviewing it. Location is flag-only, by decision.

## What changed

**Capture attestation.** When recording starts, the record page notes the
time and asks the phone for its position once (a "don't allow" leaves it
blank, silently). When recording stops it sends start, end, duration and
position with the upload-slot request. The server (`src/lib/claims/capture.ts`)
sanity-checks the timeline (end after start, duration within five seconds
of the timestamps, not from the future, not older than two days) and drops
timestamps that fail, keeps any position, measures the distance to the
course's coordinates, and stores it all on the bet with the device's user
agent. Written once, with the first upload slot, never after the footage
is sealed. Migration 012 adds the eight `bets.capture_*` columns.

**Document hashes.** Claim submission now reads the certificate and
affidavit back from storage and records SHA-256 and size on the
verification, as the footage already is. A document that is not there is
a `400 DOCUMENT_MISSING` and the claim page clears that step so the golfer
uploads again. This runs before the bet changes state.

**Witnesses.** The claim page asks for the playing partners who saw the
shot (name and email; one required, two optional) and the club official
who signed the certificate (optional). Stored in `claim_witnesses`,
replaced as a set on each submission while the claim is open. A
submission with no playing partner named, now or earlier, is a
`400 WITNESS_REQUIRED`. Batch 11 emails them; until then the admin detail
shows them and says to phone the club.

**Admin.** The verification detail shows a "Recorder report" (recording
time and length, seconds between recording end and sealing, distance from
the course with a map link and the fix's accuracy, device), the document
hashes, and the named witnesses. Long gaps and far distances are shown in
red; the thresholds become Batch 10's flags. The course edit form gains
latitude and longitude (the create form already had them), with a note on
where to find them.

**Retention and deletion.** Witness rows go when a rejected claim's
documents are purged, and with the account (cascade).

**Privacy page** gains the witness line: what is collected and that the
golfer is responsible for telling the people they name.

## Apply order

1. Migration 012 on staging, then production.
2. Deploy.
3. Admin → Courses: add coordinates to each partner course (right-click the
   clubhouse in Google Maps; the first line is "lat, lng"). Without them the
   distance is blank, not wrong.

## What to test on preview

1. Play a bet on a phone: allow location when asked at the start of
   recording. Submit a claim with one playing partner named. In the admin
   detail: recording time and length, "sealed after" a few seconds, a
   distance from the course (if the course has coordinates) with a working
   map link, the two document hashes, and the witness.
2. Same with location declined: the detail says "not shared"; everything
   else is there.
3. Submit a claim with the club official filled in and the playing partner
   blank: the Submit button stays disabled. Fill a partner with a bad
   email: the form says so. Then submit properly.
4. Trigger a missing document: start a claim, and while the certificate is
   "uploaded" delete the object in Supabase Storage, then submit. The page
   says the document did not finish uploading and puts the certificate step
   back.
5. Admin → Courses → a course: set latitude and longitude, save, reload;
   the values stick. Set one without the other: the form refuses.

## Remaining risk, and what was left alone

- **A recorder report is a claim, not a proof.** Timestamps and position
  come from the phone and can be fabricated by someone who controls the
  device. What they cannot easily do is fabricate them *consistently* with
  the bet's server timestamps, the upload time and the footage; the
  reviewer compares those, and Batch 10 turns the disagreements into flags.
- **iOS Safari asks for location every time** in some configurations.
  The prompt copy is the browser's; there is no in-app explanation before
  it. If the decline rate on preview is high, a one-line note above the
  record button is the fix.
- **Witness emails are the golfer's word.** Nothing checks the address is
  the witness's; that is what Batch 11's confirmation is for. Batch 10's
  `witness_overlap` flag catches a witness who is also a claimant.
- **Documents submitted before this batch** show "not hashed" in the
  detail. Nothing to do; they were reviewed under the old process.
