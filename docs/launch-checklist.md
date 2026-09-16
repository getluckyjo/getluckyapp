# Launch checklist

Everything the batch notes asked you to set, in one list, in the order to
do it. Tick each line in the pull request that closes it, or here.

## Decisions this list follows (16 September 2026)

- **No staging project.** The app has no real users yet, so there is one
  Supabase project: production. The `STAGING_*` scripts, the RLS suite and
  the load test stay in the repo but are not run; every one of them refuses
  the production ref by design and that is left as is.
- **The closed beta runs on the production URL with real money.** Testers
  pay real R50 entries through the live PayFast account and are refunded
  from the PayFast dashboard. No guard is relaxed: production still refuses
  sandbox PayFast, previews still refuse the production database.
- **Consequence for previews:** a Vercel preview has no database it is
  allowed to use, so PR previews do not start. Review a change by CI
  (typecheck, lint, tests, build) and by deploying it to production behind
  the beta gate.
- **Consequence for the order below:** PayFast go-live and the full
  production setup come *before* the beta, not after it. The "first real
  R50 entry" smoke test is the first beta entry.

## 1. Database (production)

- [ ] Migrations 001 to 016 applied, in order (`select * from public.schema_migrations` if bootstrap was used; otherwise the verify block at the end of each file).
- [ ] Point-in-Time Recovery on (Settings → Add-ons). The restore drill (`docs/restore-runbook.md`) needs a second project to restore into; do it once there is data worth restoring, or when a staging project exists.
- [ ] Authentication → Rate Limits: emails per hour raised from 30 to at least 500.
- [ ] Authentication → URL Configuration: Site URL is `https://www.getluckyholeinone.com`; redirect URLs cover `www` and the bare domain.
- [ ] Google provider: production callback URL registered in Google Cloud.
- [ ] Send Email hook enabled and pointing at `/api/auth/send-email` with `SEND_EMAIL_HOOK_SECRET` (`docs/auth-email-setup.md`).
- [ ] `leads` table exported and dropped, if you still want that.
- [ ] Decide the three unused columns (`holes.jackpot_amount`, `profiles.payment_token`, `profiles.home_course_id`); dropping is a one-line migration.

## 2. Vercel (Production environment)

Every variable in the README table, checked against Production, not
Preview:

- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` point at the production project.
- [ ] `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE` are the live account's; `PAYFAST_SANDBOX=false`. The app refuses to start otherwise.
- [ ] `NEXT_PUBLIC_SITE_URL=https://www.getluckyholeinone.com`.
- [ ] `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` (a verified domain), `SEND_EMAIL_HOOK_SECRET`.
- [ ] `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`.
- [ ] `OPS_ALERT_EMAIL` (defaults to Johannes).
- [ ] `CRON_SECRET` (long random string). Settings → Cron Jobs shows `/api/cron/outbox` every minute and `/api/cron/retention` nightly.
- [ ] `RISK_HASH_SALT` (16+ random characters). Pick once; rotating orphans every hash.
- [ ] `RETENTION_DAYS`, `BET_WINDOW_HOURS` only if you want other than 90 and 24.
- [ ] For the beta only: `BETA_GATE=on` and `NEXT_PUBLIC_FEEDBACK=on` on Production. Both come off again in section 7.
- [ ] Preview environment: leave its Supabase variables unset (or pointing anywhere but production). A preview that points at production refuses to start; that is the guard working.

## 3. PayFast go-live (`docs/payfast-go-live.md`)

Before the beta, because the beta takes real money.

- [ ] Live account verified with PayFast; ITN URL set to `https://www.getluckyholeinone.com/api/payments/payfast/notify`.
- [ ] Passphrase set on the PayFast side and in Vercel (identical).
- [ ] The IP allow-list in `src/lib/payfast/ips.ts` matches PayFast's current published list.
- [ ] Redeploy production. It starts (no sandbox refusal in the logs) and `/` loads signed out.
- [ ] One real R50 entry, end to end, by you, from an account that is not the merchant's own: pay, see the ledger row, the bet, the footage seal, a miss. This is also the first beta entry. Refund it from the PayFast dashboard or leave it as the first miss.

## 4. Content and people

- [ ] Every partner course: `is_partner` on, its par-3 holes active with distances, latitude and longitude set (Admin → Courses), and at least one club contact.
- [ ] Admin accounts: yours plus whoever reviews claims (`profiles.is_admin`, set in SQL, never through the app).
- [ ] `support@getluckygolf.co.za` reaches a person, and someone owns the ops alert inbox.
- [ ] Terms, privacy and responsible-play pages read by a lawyer; retention periods confirmed with Indwe.
- [ ] The witness email and the claim page copy read once by you, as the golfer and as the club manager.
- [ ] Indwe told that beta entries are real entries: a hole-in-one during the beta is a real claim against the policy. If that is not wanted, the beta is played on a hole that is not yet active, or testers are told to declare a miss.

## 5. Closed beta on production (`BETA-TESTING.md`)

- [ ] Migration 016 applied (section 1); your own email added at `/admin/beta` **before** the gate goes on. Admins are not exempt.
- [ ] `BETA_GATE=on`, `NEXT_PUBLIC_FEEDBACK=on` on Production; redeploy.
- [ ] Testers added by email or invite code; each sent the guide and told the entry is real money, refunded within a few days.
- [ ] Refund routine: PayFast dashboard → Transactions → refund each tester's entry, once, after their session; keep the `pf_payment_id` from `/admin/bets` next to each refund.
- [ ] The device checklist in `docs/pwa-verification.md` filled in for at least one Android and one iPhone.
- [ ] Session checks in `docs/pwa-sessions.md` done (lock and unlock, force-quit, eight-day gap on one phone).
- [ ] Every beta claim reviewed in the admin queue with the full checklist and one evidence pack exported, so the process is exercised before launch.
- [ ] Feedback read; anything blocking fixed and redeployed. Testers see the update toast within a minute of foregrounding the app.

## 6. Proof it holds

- [ ] Sentry alert rules exist and the test alert arrived (`docs/stage-2-safety-net.md` §4).
- [ ] Independent penetration test of the claim and payment paths booked or done.
- [ ] Vercel Web Analytics enabled on the project; the funnel events listed in `BETA-TESTING.md` show up during the beta.
- Not run, by decision: the event-day load test (`docs/batch-12-scale.md`) and the query timings (`docs/batch-6-admin-queries.md`). Both need a non-production project. At the expected volume (about one entry a minute on an event day) the beta is the load test. If a staging project is ever created, both run unchanged.

## 7. The day before

- [ ] Export the beta's `payfast_payments` rows first if you want a record of the refunded transactions inside the app; the PayFast dashboard keeps its own.
- [ ] Run `supabase/reset-before-launch.sql` in the production SQL editor (edit the guard line to arm it). It removes every beta bet, payment, claim, witness, event and object; keeps courses, contacts, profiles and users.
- [ ] Delete test accounts under Authentication → Users if you want the user list clean.
- [ ] `BETA_GATE` and `NEXT_PUBLIC_FEEDBACK` removed from Production (or set to anything but `on`).
- [ ] Redeploy production from main and open the site signed out: splash, terms, privacy load; `/admin` bounces; `/beta` is no longer offered.
- [ ] Sign in with your own account, check `/home` and `/account`, sign out.

## 8. Launch day

- [ ] Watch Vercel logs filtered on `payfast.itn` for the first hour: every `received` should be followed by `recorded`.
- [ ] Watch the ops inbox. The alerts that matter on day one: `payfast.itn.ledger_write_failed`, `payfast.itn.misconfigured`, `claim.submit_failed`, `outbox.dead_letter`.
- [ ] Admin queue open in a tab; the first claim gets the full checklist treatment and an evidence pack export.

## After the first week

- Read `retention.run` once after the first nightly run with real data.
- Tune `src/lib/risk/thresholds.ts` against what real claims look like.
- Revisit batch approve, and WhatsApp for witness confirmation if email answer rates are poor.
- Push notifications (`docs/pwa-push.md`), then the Android package (TWA) if a store listing is wanted.
