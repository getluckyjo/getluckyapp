# Batch 5 — Input validation and error handling

Closes AUDIT.md B.6 (no schema validation anywhere, internal error messages
returned to clients) and the dead-code items that were entangled with it:
the mock admin mode, the placeholder-URL checks, the mock bet-id guards and
the seed-file fallback.

## What changed

**One way in, one way out** (`src/lib/api/http.ts`)
- `parseBody(request, schema)` and `parseQuery(url, schema)`: every route
  reads its input through a zod schema. Bad input is **400 `INVALID_INPUT`**
  with a list of `{path, message}` issues. Unknown keys are dropped, so a
  body cannot smuggle a column the schema does not name.
- `apiError(event, err, opts)`: every internal failure is logged with the
  real error and a request id, captured in Sentry, and answered with a
  generic message, `code: 'INTERNAL'` and the same request id. **No route
  returns a database or library error message any more** (fourteen did).
- Order is fixed everywhere: authenticate, rate-limit, then validate, so an
  anonymous caller learns nothing about a route's schema.

**Admin API rewritten** (14 files, 24 handlers)
- Every list takes a validated query (`page` 1+, `limit` 1–50, enums for
  status/tier/sort/order, UUIDs for ids, real dates for ranges).
- Every write takes a validated body: courses (name 1–120, lat/lng ranges,
  `image_url` must be a URL), holes (number 1–18, par 3–5, distance 30–400
  m), suspension (`suspended` boolean, reason ≤ 500), review (status enum,
  notes ≤ 2000), batch (1–50 UUIDs), export (three types).
- `requireAdmin()` returns `{ ok, user, adminClient } | { ok, error }`. The
  mock admin, `ENABLE_MOCK_ADMIN` and the `YOUR_PROJECT_REF` checks are gone.
- An admin cannot suspend their own account (409). Deleting a hole with
  bets is refused (409) like deleting a course was.
- The broken PostgREST joins (`bets → profiles(name)`, which cannot resolve
  because `bets.user_id` references `auth.users`) are replaced by one
  lookup helper (`src/lib/admin/data.ts`). Export, payouts and the user
  detail now show names; the six copy-pasted fetch-then-join blocks are one
  function. The user list does one bets query per page instead of one per
  user. (These were Batch 6 items that the rewrite could not avoid.)
- Zero `any` and zero `eslint-disable` in the API. Every handler has typed
  rows.

**Player routes**: checkout, bet creation, declaration, claim submission,
upload slot, footage sealing, age check, bet list, and the Supabase auth
hook payload all go through schemas. Behaviour is unchanged; malformed
input is refused earlier and more precisely.

**Deleted**
- `src/lib/admin-mock-data.ts` (display helpers moved to `src/lib/format.ts`).
- `src/data/south-africa-courses.ts` and the `/api/courses` fallback to it:
  its ids were never valid past checkout and its images were hot-linked
  from a third-party site. A database failure is now a 500 the page handles
  with its retry state.
- `bet_mock` / `bet_fallback` guards in the miss and verify screens.

**Silent catches**: the server-side ones (membership status, the bet-creation
attempt counter, the root page session check) now log through the
structured logger; the client-side ones write to the console.

**Tests**: 249. New suites for the HTTP helpers and for admin route
validation (field issues, key stripping, empty patches, ranges, self-suspend,
list queries, batch and export inputs, generic 500 with request id, 401/403).

## Apply order

Deploy only; no migration.

## What to test on the preview URL

1. As admin, add a course with an empty name → the form shows the
   validation error; the network tab shows 400 with `issues`.
2. Add a hole numbered 19 → 400. Number 4, distance 165 → created with par 3.
3. Edit a course and change nothing → 400 "No valid fields to update".
4. Try to suspend yourself → 409.
5. Browser console as a golfer:
   `fetch('/api/bets/create', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({paymentIntentId: 'x', tier:'tier_1', courseId:'nope', holeId:'nope'})})`
   → 400 `INVALID_INPUT`, issue paths `courseId`, `holeId`.
6. Break something on purpose (rename the `courses` table in staging, or
   pull the service role key from Preview): the admin page shows a generic
   error, the response carries a `requestId`, and Sentry has an event with
   the same id and the real message.
7. Admin → Export → Bets: the CSV has user and course names filled in.
8. `/select-course` still lists partner courses with local photos; courses
   without a local photo show the placeholder, not a broken hot-link.

## Risk that remains

- **Response shapes for validation errors changed** from ad-hoc
  `{error: '...'}` to `{error, code: 'INVALID_INPUT', issues}`. The
  first-issue message is still in `error`, so existing UI copy paths work.
- **The admin panel's own forms do not validate client-side**; they rely on
  the 400. Fine for one operator; worth a pass if more admins join.
- **`z.url()` on `image_url`** means an admin cannot paste a bare path;
  local course photos are matched by name in `src/lib/course-photo.ts`, not
  by this column.
- **Name search and tier filter are still post-filters** on a page of
  results; pagination totals are wrong when they are used. Batch 6.
