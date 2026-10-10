# Launch checklist

Everything the batch notes asked you to set, in one list, in the order to
do it. Tick each line in the pull request that closes it, or here.

## Decisions this list follows (16 September 2026)

- **No staging project.** The app has no real users yet, so there is one
  Supabase project: production. The `STAGING_*` scripts, the RLS suite and
  the load test stay in the repo but are not run; every one of them refuses
  the production ref by design and that is left as is.
- **No closed beta.** The site goes live open, and the first small group of
  golfers plays for real; what they find gets fixed as it comes. The beta
  gate and the feedback button stay in the code, off. `BETA-TESTING.md`
  keeps the install instructions and the phone checks, which still apply
  to that first group.
- **Consequence for previews:** a Vercel preview has no database it is
  allowed to use, so PR previews do not start. Review a change by CI
  (typecheck, lint, tests, build), then deploy to production. No guard is
  relaxed: production still refuses sandbox PayFast, previews still refuse
  the production database.

## 1. Database (production)

- [ ] Migrations 001 to 039 applied, in order (`select * from public.schema_migrations` if bootstrap was used; otherwise the verify block at the end of each file). 037 adds the `unknown` ledger status and refunds, 038 the golf-day join code and the free-swing cap, 039 the `payout_approved` status; each must be in before the code that uses it is deployed.
- [ ] Two admin accounts exist. A payout takes two signatures (approve, then a different admin marks it paid); with one admin no prize can be paid.
- [ ] After 038: its select shows the `join_code` column, the caps row (500 a day, not paused) and the trigger. Then set the day's cap on the admin dashboard (Free swings today) to what the budget allows.
- [ ] Authentication → Attack Protection → Turnstile: enabled, with the **secret key** from the Cloudflare Turnstile widget (Cloudflare dashboard → Turnstile → the widget for `www.getluckyholeinone.com`, hostnames `www` and the bare domain). The site key goes in Vercel (below). Test a sign-in with the widget on before the link goes out.
- [ ] Point-in-Time Recovery on (Settings → Add-ons). The restore drill (`docs/restore-runbook.md`) needs a second project to restore into; do it once there is data worth restoring, or when a staging project exists.
- [ ] Authentication → Rate Limits: emails per hour raised from 30 to at least 3 000 for the Icons Cup weekend (11–13 Dec); sign-ins and OTP verifications per IP raised (mobile carriers share one address across thousands of phones).
- [ ] Resend: plan with at least 100 000 emails a month before December (an email sign-up costs two); ask support to raise the 10 requests a second limit. The hook and the welcome queue retry a 429 (`src/lib/email/send.ts`), but a cap is a cap.
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
- [ ] `CRON_SECRET` (long random string). Settings → Cron Jobs shows `/api/cron/outbox` every minute and `/api/cron/retention` nightly. After the first deploy, Sentry → Crons lists both as monitors (`docs/stage-2-safety-net.md` §4).
- [ ] `RISK_HASH_SALT` (16+ random characters). Pick once; rotating orphans every hash.
- [ ] `RETENTION_DAYS`, `BET_WINDOW_HOURS` only if you want other than 90 and 24.
- [ ] `BETA_GATE` unset. `NEXT_PUBLIC_FEEDBACK=on` only if you want the floating feedback button for the first group; it emails you what they were doing, on which screen and build.
- [ ] `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: the Turnstile widget's **site key** (its secret key is in Supabase, above). Redeploy after setting it: it is read at build time. Without it the sign-in screen has no widget, and Supabase will refuse every sign-in if Turnstile is on there, so set both or neither.
- [ ] `FREE_SWING_PAUSED` unset. `on` is the kill switch for free swings when the database cannot be reached to pause them from the admin.
- [ ] Preview environment: leave its Supabase variables unset (or pointing anywhere but production). A preview that points at production refuses to start; that is the guard working.

## 3. PayFast go-live (`docs/payfast-go-live.md`)

- [ ] Live account verified with PayFast; ITN URL set to `https://www.getluckyholeinone.com/api/payments/payfast/notify`.
- [ ] Passphrase set on the PayFast side and in Vercel (identical).
- [ ] The IP allow-list in `src/lib/payfast/ips.ts` matches PayFast's current published list.
- [ ] Redeploy production. It starts (no sandbox refusal in the logs) and `/` loads signed out.
- [ ] One real R50 entry, end to end, by you, from an account that is not the merchant's own: pay, see the ledger row, the bet, the footage seal, a miss. Refund it from the PayFast dashboard or leave it as the first miss.

## 4. Content and people

- [ ] Every partner course: `is_partner` on, its par-3 holes active with distances, latitude and longitude set (Admin → Courses), and at least one club contact.
- [ ] Saved cards: migration 021 applied; PayFast Settings → Recurring Billing enabled with ad hoc payments (see `docs/payfast-go-live.md`).
- [x] Only par 3s of 140 m or more are playable (`src/lib/holes.ts`; checkout refuses shorter holes, the app greys them out with the reason). Set by Johannes on 16 Sep 2026; 140 m counts.
- [ ] Admin accounts: yours plus whoever reviews claims (`profiles.is_admin`, set in SQL, never through the app).
- [ ] `support@getluckygolf.co.za` reaches a person, and someone owns the ops alert inbox.
- [ ] Terms, privacy and responsible-play pages read by a lawyer, including the new section 5 (Icons Cup fan prize) and the eligibility split (18+ for everyone, South African residents for paid entries); retention periods confirmed with Indwe.
- [ ] Icons: first tee set at `/admin/icons`; the freeze runs before the shot and its hash is published (`docs/icons.md`).
- [ ] The witness email and the claim page copy read once by you, as the golfer and as the club manager.
- [ ] Indwe knows the go-live date: every entry from that day is a real claim against the policy, including the first group's.

## 5. Proof it holds

- [ ] Sentry alert rules exist and the test alert arrived (`docs/stage-2-safety-net.md` §4).
- [ ] An uptime monitor (Vercel, Better Stack, or similar) polls `https://www.getluckyholeinone.com/api/health` once a minute and alerts on anything but 200. The first call answers `{ ok: true, db: 'ok', … }`.
- [ ] Independent penetration test of the claim and payment paths booked or done.
- [ ] Vercel Web Analytics enabled on the project; the funnel events listed in `BETA-TESTING.md` show up from the first golfers.
- Not run, by decision: the event-day load test (`docs/batch-12-scale.md`) and the query timings (`docs/batch-6-admin-queries.md`). Both need a non-production project. At the expected volume (about one entry a minute on an event day) the first event is the load test; watch the admin pages and the ITN logs during it. If a staging project is ever created, both run unchanged.

## 6. The day before

- [ ] Run `supabase/reset-before-launch.sql` in the production SQL editor (edit the guard line to arm it). It removes every test bet, payment, claim, witness, event and object; keeps courses, contacts, profiles and users.
- [ ] Delete test accounts under Authentication → Users if you want the user list clean.
- [ ] Redeploy production from main and open the site signed out: splash, terms, privacy load; `/admin` bounces.
- [ ] Sign in with your own account, check `/home` and `/account`, sign out.

## 7. Launch day

- [ ] Watch Vercel logs filtered on `payfast.itn` for the first hour: every `received` should be followed by `recorded`.
- [ ] Watch the ops inbox. The alerts that matter on day one: `payfast.itn.ledger_write_failed`, `payfast.itn.misconfigured`, `claim.submit_failed`, `outbox.dead_letter`.
- [ ] Admin queue open in a tab; the first claim gets the full checklist treatment and an evidence pack export, so the process is exercised while it is quiet.
- [ ] The first group of golfers knows how to reach you (the feedback button if it is on, otherwise `support@getluckygolf.co.za`), and knows the install steps in `BETA-TESTING.md` for a home-screen icon.

## After the first week

- Fill in the phone columns of `docs/pwa-verification.md` from what the first group reports.
- Read `retention.run` once after the first nightly run with real data.
- Tune `src/lib/risk/thresholds.ts` against what real claims look like.
- Revisit batch approve, and WhatsApp for witness confirmation if email answer rates are poor.
- Push notifications (`docs/pwa-push.md`), then the Android package (TWA) if a store listing is wanted.
