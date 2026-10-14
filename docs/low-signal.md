# Low signal on the course

Golfers use the app where the signal is weak and drops mid-request. This
is the contract for how the app behaves there, written for the first PR
of the low-signal work (October 2026) and extended by the ones after it.

## The shot never waits on the network

1. **The phone's copy first.** The moment recording stops, the clip, the
   recorder's report and the session go into IndexedDB
   (`src/lib/footage-store.ts`). From there a reload, a killed tab or a
   dead battery loses nothing. The copy lives a week (`FOOTAGE_TTL_MS`),
   matching the server's footage window below, and is deleted only once
   the server has the hash (`deleteFootageIfSealed`). Nothing else deletes
   an unsealed shot.
2. **The upload manager** (`src/lib/upload/manager.ts`) owns getting each
   shot to the server. It is one object for the whole app, built lazily by
   `getUploadManager()` and booted at the root
   (`src/components/pwa/UploadManagerBoot.tsx`), so leaving the play
   screens, tapping Home or the provider remounting cannot abandon an
   upload. On every launch it re-queues every unsealed shot the phone
   holds. Screens read it with `useUpload(betId)` and show
   `uploadChip(state)`.
3. **An attempt is seal → slot → PUT → seal.** The seal comes first
   because a PUT that landed on a bad link often loses its answer: asking
   `/api/videos/uploaded` before sending anything turns that into a
   finished upload with no bytes over the air. `404 FOOTAGE_MISSING` means
   nothing is there yet. Every slot (`/api/videos/upload-url`) gets its own
   object name, `shot-<8 hex>.<ext>`, so a retry never hits "resource
   already exists" and the bucket needs no upsert right. The pointer on the
   bet moves to the newest slot until the seal fixes it; the seal then
   removes the other attempts' objects.
4. **Waiting.** A failure that may pass (offline, dropped, timed out, 429,
   5xx) waits on `UPLOAD_BACKOFF_MS` = 2 s, 5 s, 15 s, 30 s, 60 s, 2 min,
   5 min, then 5 min for ever, with ±20% jitter; a 429 waits at least its
   Retry-After; a 401 waits for the session to come back (60 s at most).
   The wait ends early when the phone comes online, the app returns to
   the foreground (`visibilitychange`, `pageshow`, `focus`) or the golfer
   signs in; the chip says "Waiting for signal" / "Retrying in 15s" and a
   tap retries now. The PUT's stall timer (45 s with no progress) is
   paused while the page is hidden: iOS suspends a background XHR and the
   old timer aborted good uploads the moment the golfer switched apps.
5. **Blocked.** 403 (not their bet), 410 `FOOTAGE_WINDOW_CLOSED`, 413 (too
   large), a bad type, or a resolved bet stop the attempts and the chip
   says why. A tap gives it one more go.

## Declaring and claiming do not wait either

- "Yes, it went in!" is available as soon as the replay is on the screen.
  The claim form can be filled in and submitted while the video is still
  leaving the phone; the claim's `footage_received_at` stays null until
  the seal stamps it, and `/verify` shows "Still uploading from your phone"
  until then (the GET returns `footageSealed`). Reviewers see a claim
  without footage as what it is.
- A recorded miss keeps uploading. The server's footage window
  (`src/lib/claims/footage-window.ts`) lets a bet that is active, a miss or
  a claim receive footage until **seven days after the play window**; a
  verified, paid, rejected or expired bet may not.
- The miss itself is sent with `fetchJson` (four retries, backoff 1/3/8/20
  s; the server is idempotent) and, failing that, once more when the phone
  comes online.

## `fetchJson`

`src/lib/net/fetch-json.ts` is the one way to call our API from a screen.
Every attempt has a timeout (15 s by default). Transient failures are
retried with backoff only when retrying is safe: GET, or the caller set
`retries` (asserting the server is idempotent), or an `Idempotency-Key` is
sent. 401/403/409/410 and other 4xx are answers, never retried. Before an
attempt, if the browser says it is offline, the call waits up to 30 s for
`online`. Failures are `NetError { kind }` and `netErrorMessage(err)` says
it in the app's voice.

## What the server promises

| Route | On a repeat |
|---|---|
| `POST /api/videos/uploaded` | `200 alreadyRecorded` once sealed; `404 FOOTAGE_MISSING` until the bytes land |
| `POST /api/videos/upload-url` | a new slot each time until the seal, then `409 FOOTAGE_SEALED` |
| `PATCH /api/bets/:id` (miss) | `200 alreadyDone` |

Rate limit `upload` is 60 per golfer per 10 minutes (three calls per attempt).

## Telemetry

`footage_recorded { bytes, seconds, mime, ios }` on every recording. The
500 kbit/s hint is ignored by iOS Safari; these numbers decide whether
chunked resumable uploads (tus) are worth adding.

## On a real phone

iPhone (Safari and the installed app) and one Android: record; lock the
phone mid-upload, unlock, the progress resumes; airplane mode mid-upload,
the chip says waiting, off again, it finishes; tap Home mid-upload,
`bets.video_sha256` is still written; declare a miss while uploading, it
still seals; kill the app mid-upload, relaunch, it resumes.
