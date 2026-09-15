# Batch 3 — Payment path hardening

Closes AUDIT.md B.3: the sandbox-in-production foot-gun, the double-bet on a
retried return, the predictable payment reference, the unvalidated checkout
target, and the ITN's silent failure modes.

## What changed

**Configuration (`src/lib/payfast/config.ts`)**
- No built-in PayFast credentials any more. Both PayFast routes resolve
  their config per request and answer **503 `PAYMENTS_UNAVAILABLE`** (with an
  ops alert) if `PAYFAST_MERCHANT_ID` or `PAYFAST_MERCHANT_KEY` is missing.
- In production (`VERCEL_ENV=production`) the routes also refuse unless
  `PAYFAST_SANDBOX` is exactly `false`, `PAYFAST_PASSPHRASE` is set,
  `NEXT_PUBLIC_SITE_URL` is set, and the merchant id is not PayFast's shared
  sandbox account.
- The start-up guard (`src/instrumentation.ts`) now **throws** for a
  production deployment in sandbox mode, so the deployment itself fails.

**Checkout (`POST /api/payments/payfast`)**
- `m_payment_id` is `gl_<uuid>`: unguessable and collision-free.
- The target hole must exist, be `is_active`, belong to the given course,
  and the course must be `is_partner`. Course and hole ids must be UUIDs
  (the seed-file fallback ids never worked past checkout anyway).
- The amount comes from `BET_TIERS`; the duplicate tier table in the route
  is gone.

**ITN (`POST /api/payments/payfast/notify`)**
- 10-second timeout on the phone-home `validate` call; fails closed.
- An unexpected error after validation answers **500** so PayFast retries,
  instead of 200 and losing the payment.
- The ITN no longer rewrites `bets.payment_intent_id`. PayFast's id goes into
  the new `bets.pf_payment_id`; our reference is stable for the life of the
  bet.

**Bet creation (`POST /api/bets/create`)**
- Idempotency looks up by our reference (stable now) and, for bets created
  before migration 008, by PayFast's id. One payment, one bet.
- No fallback to the request body: a ledger row without course/hole answers
  402 `PAYMENT_UNMATCHED` and raises an alert.
- The ledger row is linked to the bet it produced
  (`payfast_payments.bet_id`).

**Courses (`GET /api/courses`)**: only partner courses are offered, so the
select-course screen cannot lead a golfer to a checkout that will be
refused.

**Migration 008**: `bets.pf_payment_id`, `payfast_payments.bet_id`, and a
backfill that restores our reference on bets the old ITN had swapped. Its
final SELECT lists any payment with two bets and any bet whose reference
could not be restored; both need a human.

**Tests**: 220. The checkout suite now runs the real route without module
reloads; the ITN suite covers the timeout, the 503s, the reference link and
the 500-on-unhandled path; a config suite pins every refusal rule.

## Apply order

Migration first, then deploy.

1. Before applying, look at what the backfill will touch:
   `select count(*) from bets where payment_intent_id not like 'gl_%'`.
2. Run `supabase/migrations/008_payment_hardening.sql`. Read its final
   SELECT: an empty result means clean. `duplicates` rows mean one payment
   produced two bets (refund one and delete it); `swapped_orphans` rows are
   bets whose original reference we could not restore.
3. Confirm production env vars (Vercel → Production): `PAYFAST_MERCHANT_ID`,
   `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`, `PAYFAST_SANDBOX=false`,
   `NEXT_PUBLIC_SITE_URL=https://www.getluckyholeinone.com`. **Any one
   missing and the deployment will refuse to start.** That is the point, but
   check before you deploy, not after.
4. Confirm Preview env vars have a real PayFast **sandbox** merchant id and
   key (from sandbox.payfast.co.za), not the shared `10000100`. Previews now
   answer 503 on checkout without them.
5. Check partner flags: `select name from courses where is_partner = false`.
   Those courses disappear from the app. If any of them should be playable,
   flip the flag in the admin panel first.
6. Merge and deploy.

## What to test on the preview URL

1. `/select-course` lists only partner courses.
2. Full sandbox play: the PayFast sandbox form shows your sandbox merchant id
   and an `m_payment_id` of the form `gl_<uuid>`. Pay, return, record.
3. On `/payment-return`, refresh the page twice while it is "Confirming your
   payment" and after it lands on `/record`. `/history` shows **one** bet.
4. In the SQL editor: the bet has `payment_intent_id` starting `gl_` and a
   numeric `pf_payment_id`; the `payfast_payments` row has `bet_id` set.
5. Temporarily remove `PAYFAST_MERCHANT_KEY` from Preview and redeploy: the
   stake screen shows "Payments are temporarily unavailable" and an alert
   email arrives. Put it back.
6. Set a hole `is_active = false` in the admin panel; that hole no longer
   appears; a crafted checkout for its id (browser console `fetch`) gets
   400 `HOLE_INACTIVE`.

## Risk that remains

- **Partner filter.** Non-partner courses vanish from the app the moment
  this deploys. Step 5 above is not optional.
- **Amount encoding edge.** Signatures follow PayFast's published Node
  sample (`encodeURIComponent` with `%20 → +`), which differs from PHP's
  `urlencode` for `!*'()~`. Names containing those characters are stripped
  before signing, so it cannot bite today; a future free-text field would
  need to be encoded the PHP way.
- **The ledger link is best-effort.** If setting `payfast_payments.bet_id`
  fails, the bet still exists and a warning is logged; reconciliation falls
  back to matching on `m_payment_id`.
- **Rate limiting is still the in-memory stub** (Batch 4).
