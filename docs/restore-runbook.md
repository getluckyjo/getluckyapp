# Database restore runbook

When to use this: data was deleted or corrupted in production (a bad
migration, an admin mistake, a bug that overwrote rows), or Supabase reports
an incident and you need to prove the backups are good.

Two ways to restore. **Prefer A.** B is for when PITR is unavailable or you
only need one table back.

---

## A. Point-in-Time Recovery (whole project, to a moment)

PITR rewinds the *entire* database to a chosen second. Everything written
after that moment is lost, including payments recorded by the ITN. So:

1. **Stop the bleeding first.** Vercel → `get-lucky-golf` → Settings →
   Deployment Protection, or simply pause the project (Vercel → Pause
   Project). Golfers see an error page; nobody pays into a database you are
   about to rewind.
2. **Capture what will be lost.** Run this in the SQL editor and save the
   output; you will re-apply it by hand afterwards:
   ```sql
   select * from public.payfast_payments where created_at > '<incident time>' order by created_at;
   select * from public.bets where created_at > '<incident time>' order by created_at;
   select * from public.verifications where created_at > '<incident time>';
   ```
3. Supabase → Project Settings → Database → Backups → **Point in Time** →
   pick the timestamp (UTC) just before the incident → Restore. Takes 5–20
   minutes; the project is unavailable meanwhile.
4. When it is back: `npm run staging:verify-restore` style checks against
   production (see the SQL in step C below; do **not** run the script itself
   against production, it refuses). Compare row counts and newest timestamps
   with what you expect.
5. Re-insert the rows captured in step 2 that are still valid (real payments
   always are; bets created from them usually are). Use the service role in
   the SQL editor. Every re-inserted row is a manual write to a money table:
   note it in the incident log with who did it and when.
6. Unpause Vercel. Check Sentry for the next hour.

Retention: the PITR window is shown on the Backups page. If the incident is
older than the window, use B with the most recent daily backup.

## B. Restore a daily backup into a fresh project, then copy rows across

For a single table, or when PITR cannot reach the point you need.

1. Supabase → Backups → Daily → Download the backup taken before the
   incident (a `.backup` / SQL dump).
2. Create a scratch project (or reuse staging: it is going to be overwritten).
3. Restore into it:
   ```bash
   psql "$STAGING_DATABASE_URL" -c 'drop schema public cascade; create schema public;'
   psql "$STAGING_DATABASE_URL" < backup.sql
   ```
   (Supabase's dumps are plain SQL; if you were given a custom-format
   archive, use `pg_restore --clean --no-owner -d "$STAGING_DATABASE_URL" backup.dump`.)
4. Verify: `STAGING_DATABASE_URL=... npm run staging:verify-restore`.
5. Copy the rows you need into production with `pg_dump --data-only
   --table=public.<table>` from the scratch project and `psql` into
   production, or by hand in the SQL editor for a handful of rows.

Storage (videos, documents) is not in the database backup. Supabase Storage
objects live in S3 with their own durability; if objects were deleted, open a
Supabase support ticket immediately, since object deletion is not reversible
from the dashboard.

## C. The drill (do this once against staging, then yearly)

Purpose: prove the backup is restorable and that we know how long it takes.

1. `STAGING_DATABASE_URL=... npm run staging:verify-restore` → save the
   output as "before".
2. Download yesterday's **production** daily backup.
3. Restore it into staging with the commands in B.3. Time it.
4. `npm run staging:verify-restore` again → "after". Row counts should match
   production's own counts from the same time (run the "Row counts" query
   from `scripts/staging/verify-restore.mjs` in the production SQL editor to
   compare). `bets_without_ledger` and `ledger_without_bet` should be the
   same small numbers on both sides. `ids_md5` must match.
5. Re-seed staging afterwards (`npm run staging:seed`) so the fake data is
   back and no production PII stays in staging. **This matters under POPIA:
   a copy of production in staging is a second place you hold personal
   data.** Do not leave it there.
6. Record below.

| Date | Backup used | Restore time | Rows (bets / ledger / users) | ids_md5 matched | Done by |
|---|---|---|---|---|---|
| _not yet run_ | | | | | |

## Notes

- `scripts/staging/verify-restore.mjs` and `bootstrap.mjs` refuse a
  connection string containing the production project ref. That is
  deliberate; there is no flag to override it.
- After any restore, run the RLS suite (`npm run test:staging`) against the
  restored project. A restore from before the Batch 1 migration brings the
  open policies back.
