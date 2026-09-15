# Batch 1 — RLS lockdown

Closes AUDIT.md B.1 (all four Critical RLS findings) and the `increment_attempts`
High. Pairs `supabase/migrations/006_rls_lockdown.sql` with the code changes
that move every remaining client-side write behind an API route.

## What changed

**Database (migration 006)**
- `profiles`: the `for all` policy is replaced by select / insert / update on
  the caller's own row, plus a `BEFORE INSERT OR UPDATE` trigger that rejects
  client changes to `is_admin`, `suspended_at`, `suspended_reason`,
  `total_attempts`, `age_verified_at`, `terms_accepted_at`, `date_of_birth`.
  The service role, the dashboard and Supabase's auth role are exempt.
- `bets` and `verifications`: client insert and update policies dropped.
  Select-own stays.
- `verification-docs` bucket: the three "any authenticated user" policies are
  replaced by insert and select scoped to `<uid>/…`. No update policy, so a
  document cannot be replaced after upload.
- `increment_attempts()`: execute revoked from `anon` and `authenticated`.

**Code**
- New `POST /api/profile/age-check`: the 18+ decision and the write of the
  three trust columns now happen on the server. `/age-check` calls it.
- `POST /api/bets/create`: insert and the attempt counter use the service
  role (ownership is fixed by the ledger row and the session).
- `PATCH /api/bets/[betId]`: ownership check through the user's client
  (RLS), then a service-role write. Other users' bets return 404.
- `POST /api/verifications/[betId]`: ownership check; evidence paths must be
  under `<uid>/<betId>/`; a claim that is `under_review`, `approved` or
  `rejected` returns 409 `CLAIM_LOCKED`; writes use the service role. A
  resubmit before review updates the same row instead of erroring.
- `POST /api/videos/verify`: only a path under `<uid>/<betId>/` on the
  caller's own bet can be attached as footage.
- `/result/claim`: documents upload to `<uid>/<betId>/<step>/<ts>-<name>`,
  never overwritten.
- CI: the staging job applies this branch's migrations before running the
  RLS suite (needs the `STAGING_DATABASE_URL` secret).
- Tests: the seven RLS `it.fails` are now plain `it`; the claims suite gained
  path-validation, lock and footage-attach cases; a new suite covers the
  age-check route. 173 tests.

## Apply order

Code first, then the migration. The new code works under both the old and the
new policies; the old code does not work under the new policies.

1. Merge and deploy this branch to production.
2. Run `supabase/migrations/006_rls_lockdown.sql` in the production SQL editor
   (or `DATABASE_URL=… node scripts/run-sql.mjs supabase/migrations/006_rls_lockdown.sql`).
   The final SELECT prints the policy set; compare it with the list in the
   file's header.
3. Run the RLS suite against staging (CI does this on the PR; locally:
   `npm run test:staging` with the `STAGING_*` variables). All 12 must pass.

## What to test on the preview URL

Sign in as `golfer01@getlucky.test`:
1. `/age-check` with a DOB under 18 → signed out, blocked screen. Over 18 with
   consent → `/welcome`. (Seeded users are already verified; use a fresh
   Google sign-in or a new seeded user to see the gate.)
2. Full sandbox play: select course → pay in PayFast sandbox → `/record` →
   declare a miss. `/history` shows it as a miss.
3. Play again, declare a win, upload two files on `/result/claim` (any image
   or PDF), submit → `/verify` shows "Documents received".
4. Go back to `/result/claim` for the same bet and submit again → the app
   still works (before review, resubmission updates the same claim).
5. `/account`: edit name and handicap → saves.

Sign in as `seed-admin@getlucky.test`:
6. `/admin/verification-queue` → open the claim from step 3, both documents
   open, reject it with a note.
7. As the golfer, try to resubmit → 409 (the app shows an error; Batch 2
   gives this a proper screen).

With the browser console on the preview, as a golfer (this is the point of
the batch):
```js
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
const sb = createClient('<staging url>', '<staging anon key>')
await sb.auth.signInWithPassword({ email: 'golfer01@getlucky.test', password: 'seed-Passw0rd!' })
await sb.from('profiles').update({ is_admin: true }).eq('id', (await sb.auth.getUser()).data.user.id)   // → error 42501
await sb.from('bets').insert({ user_id: '…', course_id: '…', hole_id: '…', tier: 'tier_5', stake_pence: 0, potential_win_pence: 1e8 }) // → error
await sb.storage.from('verification-docs').list('')  // → []
```

## Risk that remains

- **Production data under the old document path.** Objects already in
  `verification-docs` sit under `<betId>/…`. The admin can still open them
  (service role); the golfer who uploaded them can no longer see them, which
  is fine because nothing in the player UI lists them.
- **Legacy profiles without a row.** Anyone created before the signup trigger
  existed has no `profiles` row; the insert policy covers the first upsert.
- **The trigger keys on `current_user`.** That is how Supabase's PostgREST
  runs client requests (`anon` / `authenticated`) and service requests
  (`service_role`). If Supabase ever changes that model, the guard would need
  `auth.jwt()` instead. The RLS suite would catch it.
- **State machine is still Batch 2.** A player can still turn a declared miss
  into a claim, and a `verified` bet can still be set to `miss` by its owner.
  Both are pinned by `it.fails` in `__tests__/money/claims.test.ts`.
- **Admin is still a flag on `profiles`**, now server-only. Batch 2's audit
  log will record who changes it.
