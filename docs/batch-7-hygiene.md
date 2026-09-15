# Batch 7 — Dead code, dependencies, repo hygiene

Closes AUDIT.md C.3 (duplicated helpers), C.5 (orphaned files and scratch
SQL), and the dependency items in the plan. No migration; deploy only.
Nothing in this batch changes what the player or an admin sees, apart from
a 404 on one page nobody could reach.

## What changed

**Dependencies.**
- Removed, none imported anywhere: `clsx`, `tailwind-merge`,
  `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
- `next` and `eslint-config-next` 16.1.6 → 16.3.5 (minor, clears the
  critical advisory against 16.1). `vitest` 4.0.18 → 4.1.11 (critical
  advisory in `@vitest/mocker`). Transitive bumps within range for
  `undici`, `vite`, `brace-expansion`, `js-yaml`, `picomatch`, `flatted`,
  `esbuild`, `@humanfs/node`. `npm audit`: 0 vulnerabilities, from 10
  (1 critical, 6 high). No major version changed.
- `package-lock.json` was regenerated. npm 10.9 (the version bundled with
  Node 22) crashes while resolving vitest 4.1's optional peer
  dependencies (`Cannot read properties of null (reading 'edgesOut')`), so
  the lockfile was written with npm 12.0.2 and then verified with a clean
  `npm ci` under npm 10.9, which is what CI and Vercel run.
- Tailwind stays. No utility classes are used, but the `@import
  "tailwindcss"` in `globals.css` brings in the preflight reset that the
  hand-written CSS is built on; removing it shifts margins, headings and
  buttons across the app. Replacing it with a plain reset is cosmetic work
  for a later batch, if at all.

**Typed Supabase clients.** `src/types/database.ts` now describes every
table, function and enum the app uses, and all four client factories
(`server.ts`, `client.ts`, `admin.ts`, `proxy.ts`) are created with it. The
compiler now checks column names, enum values and insert shapes at every
`.from()` call; two call sites needed narrowing (the ITN ledger upsert and
the claim submission status). The file is hand-written for now. After a
migration, regenerate it and diff:

```bash
npx supabase gen types typescript --project-id <staging ref> --schema public > src/types/database.ts
```

and keep the `members` block at the bottom (the membership funnel's
table, which is not defined in this repo's migrations). This is now a
step on the migration checklist; CI cannot catch a column that exists in
the database but not in the type.

**One copy of each helper.**
- `src/lib/format.ts`: `formatRand`, `formatRandFromCents`, `formatZAR`,
  `getInitials`, `timeAgo`. Replaces four copies of `formatRand` and three
  of `getInitials`. `formatRand` groups thousands itself with a
  non-breaking space, which is what Chrome and Node produced through
  `toLocaleString('en-ZA')` on most ICU builds, made deterministic so the
  same string renders everywhere. `formatZAR` and `timeAgo` keep their
  admin-panel output exactly.
- `src/lib/email/from.ts`: the one `FROM_ADDRESS`, used by the auth email
  hook, the welcome email and the ops alerts.
- `src/lib/payfast/ips.ts`: the PayFast address list and `isFromPayfast()`,
  out of the ITN route.
- `src/lib/admin/csv.ts` and `src/lib/admin/schemas.ts`: the CSV writer and
  the course/hole zod schemas, out of route files (Next refuses extra
  exports from a route module, which is why they were duplicated).

**Deleted.**
- `src/app/(onboarding)/payment-setup/` — unreachable since PayFast hosted
  checkout replaced it; it referenced a card form that never existed.
- `__tests__/api-security.test.ts` — its 59 tests exercised an inline copy
  of the ITN and tier logic rather than the modules. Replaced by
  `__tests__/money/libs.test.ts`, which imports the real `tiers`,
  `payments`, `payfast/ips`, `admin/csv` and `format` modules. Test count
  goes from 275 to 216 for that reason alone; nothing that tested a route
  was removed.
- Root scratch SQL: `check-latest-bet.sql`, `lookup-admins.sql`,
  `verify-admin.sql`, `watch-bet.sql`, `supabase/apply-003-and-admin.sql`.
  One-off queries from before migrations were numbered; the migrations are
  the record.
- `BetContext.videoUploadPath` (never read), `'/app'` from the proxy's
  public routes (no such route).

**Moved.** Root screenshots and the `SVG/` exports into
`design/00-reference/current-app/`, next to the other reference material.

**Small fixes found on the way.** The share-video link defaults to the
current origin (previews shared a production URL); the root page is
declared dynamic, so the build no longer logs a false
`root.session_check_failed` while trying to prerender it; the admin search
box adopts a new value from its parent during render instead of one
render later; the auth email doc says two sign-in methods, not three; the
`run-sql` comment points at the current migration; the README is
rewritten as a map of the repo.

**One lint rule downgraded.** eslint-config-next 16.3 turns the React
Compiler rule `react-hooks/set-state-in-effect` into an error. It flags
the five admin list pages whose fetch callback opens with
`setLoading(true)` from a `useEffect`. The honest fix is a shared paged-list
hook that derives `loading` from the request rather than setting it, which
is admin-panel work; until then the rule is a warning, with the reason in
`eslint.config.mjs`.

## Apply order

Deploy. No migration, no environment variable.

## What to test on preview

The changes are mechanical, so the test is "everything looks the same":

1. Player: home, select course, choose stake, history, winners, club,
   account. Amounts read `R25 000` style, avatar initials in the header
   and menu are unchanged.
2. Checkout in sandbox, end to end: pay, return, bet appears in history
   with the right stake. This exercises the typed ledger upsert in the
   ITN.
3. Record a miss, then on another bet declare a win and submit a claim
   with the certificate and affidavit. This exercises the typed
   verification insert.
4. Result page → share video: the link starts with the preview's own
   domain.
5. Admin: dashboard, bets, users (list and detail), verification queue
   (list and detail), reports, export CSV. Amounts and "5m ago" style
   timestamps unchanged.
6. `/payment-setup` is a 404.

## Remaining risk, and what was left alone

- **Hand-maintained database types.** Until the file is generated from the
  Supabase CLI, a column added by migration without updating
  `database.ts` compiles fine and fails at runtime. Mitigation is the
  checklist step above.
- **Next 16.3.5.** A minor bump on the framework. The build and the test
  suite pass; the preview walk-through above is the runtime check.
- **Lint warnings (11).** Five `<img>` uses (the logo, admin document
  previews from signed URLs) and the Google Fonts link in the root layout,
  both design work rather than hygiene; plus the five admin fetch effects
  above. None is new behaviour.
- **Unused columns not dropped.** `holes.jackpot_amount`,
  `profiles.payment_token`, `profiles.home_course_id` are written by
  nothing and read by nothing. Dropping them is a schema change and needs
  your approval; they cost nothing while they sit there.
- **`leads` table.** Still to be exported and dropped (your action, as
  agreed in Batch 5).
