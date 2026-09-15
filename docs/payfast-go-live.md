# PayFast Go-Live Runbook

How to switch Get Lucky Golf from **sandbox** (fake money) to **live** (real money).
Do this only when you're ready to accept real payments. Until every step here is
done, the app falls back to PayFast's shared sandbox test account and no real
money moves.

> ⚠️ Real money. Test the full flow with a real R50 entry before announcing launch.

---

## How payments work (so the steps make sense)

1. **Checkout** — `POST /api/payments/payfast` ([route](../src/app/api/payments/payfast/route.ts))
   signs the entry with your merchant credentials and returns a form the client
   submits to PayFast's hosted checkout page (cards, EFT, Apple/Google Pay).
2. **User pays** on PayFast, then is redirected back to `/payment-return`
   (or `/choose-stake` if they cancel).
3. **ITN webhook** — PayFast calls `POST /api/payments/payfast/notify`
   ([route](../src/app/api/payments/payfast/notify/route.ts)) server-to-server.
   This is the source of truth that a payment completed. It verifies the IP,
   the MD5 signature, phones home to PayFast to confirm the ITN is genuine,
   checks the merchant ID, then records the payment in the `payfast_payments` ledger, which is what lets the bet be created and stores PayFast's
   `pf_payment_id` for reconciliation.

The browser redirect is **not** trusted for payment confirmation — only the ITN is.

---

## Step 0 — apply migration 005 FIRST (new, and order matters)

`supabase/migrations/005_payment_verification.sql` adds the `payfast_payments` ledger
that the ITN writes and that `/api/bets/create` checks before granting a bet.

**Apply it before deploying the code that depends on it.** Bet creation fails
closed without the table — nobody can play, rather than everybody playing free —
which is the safe direction but is still an outage. If the ITN logs
`relation "payfast_payments" does not exist`, this step was skipped.

```bash
# via the repo helper
DATABASE_URL='...' node scripts/run-sql.mjs supabase/migrations/005_payment_verification.sql
```

It also adds a unique index on `bets.payment_intent_id`. `bets/create` already
handled error 23505 on that column, but no constraint existed for it to catch,
so two concurrent payment-return tabs could each create an active bet for one
payment.

### What changed in the payment path

- The checkout now carries `user_id`, `course_id`, `hole_id` and `tier` in PayFast's `custom_str1..4`. They sit inside the signed payload, so they cannot be altered without breaking the MD5 signature.
- The ITN verifies the **amount** against the tier before recording anything, then writes the `payfast_payments` row. It returns 500 if the ledger write fails, so PayFast retries rather than the payment being silently lost.
- `/api/bets/create` no longer creates a bet from the browser's say-so. It requires a `complete` `payfast_payments` row belonging to the signed-in user, and builds the bet from **that** row's course, hole and tier — not the request body.
- The ITN often beats the browser back. `/api/bets/create` therefore returns `202 PAYMENT_PENDING` when the ledger row has not landed yet, and `/payment-return` polls for about 30 seconds showing "Confirming Your Payment".

**Operational consequence worth knowing:** the ITN is now on the critical path.
If PayFast cannot reach `/api/payments/payfast/notify` — a new source IP outside
`VALID_IPS`, a passphrase mismatch, a paused project — payments will succeed and
no one will get a bet. That is the correct failure direction, but watch the ITN
logs on go-live day. This has bitten before: commit `bfbfb0d`.

---

## Step 1 — Get your live PayFast account ready

1. Log in to the PayFast dashboard for your **live** (not sandbox) merchant account.
2. Note your **Merchant ID** and **Merchant Key**.
3. Set a **Passphrase** (Settings → Integration). This is required for signature
   security in production — do not leave it blank.
4. Under **Settings → Integration**, set/confirm the **Notify URL** (ITN) points at
   your production domain: `https://<your-domain>/api/payments/payfast/notify`.
   (The code also sends `notify_url` per-transaction, but setting it in the
   dashboard is good defense in depth.)

## Step 2 — Set production environment variables

Set these on the production host (Vercel → Project → Settings → Environment
Variables). They are currently **commented out / sandbox** in
[`.env.local`](../.env.local).

| Variable | Live value |
|---|---|
| `PAYFAST_MERCHANT_ID` | your live merchant ID |
| `PAYFAST_MERCHANT_KEY` | your live merchant key |
| `PAYFAST_PASSPHRASE` | the passphrase you set in Step 1 |
| `PAYFAST_SANDBOX` | `false` |
| `NEXT_PUBLIC_SITE_URL` | `https://<your-production-domain>` (no trailing slash) |

Also confirm these are set (used by the ITN handler to write the bet):

| Variable | Why |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | ITN uses the admin client to update the bet row. If missing, payments succeed but bets are never confirmed in the DB. |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | auth on the checkout route |

> `PAYFAST_SANDBOX` defaults to `true` everywhere. It is only "off" when the value
> is exactly the string `false`. Anything else (unset, `False`, `0`) stays in sandbox.
>
> Since Batch 3 a **production** deployment refuses to start in sandbox, refuses
> to start without `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`,
> `PAYFAST_PASSPHRASE` and `NEXT_PUBLIC_SITE_URL`, and the two PayFast routes
> answer 503 (with an ops alert) if any of that is wrong at request time. There
> are no built-in fallback credentials any more: previews need a PayFast
> sandbox account of their own.

## Step 3 — Redeploy

Env-var changes only take effect on a new deployment. Redeploy production after
saving them.

## Step 4 — Keep the ITN IP allow-list current

The ITN handler hard-rejects (`403`) any notification whose source IP isn't in
`VALID_IPS`, then authenticates the rest with the MD5 signature (your passphrase)
and a server-side phone-home `validate` call. `VALID_IPS` now covers PayFast's
**full current published ranges**: 197.97.145.144/28, 41.74.179.192/27,
102.216.36.0/28, 102.216.36.128/28, and 144.126.193.139.

⚠️ PayFast occasionally adds IP ranges. If bets stop being confirmed after a
successful payment and you see `[PayFast ITN] Rejected — no valid IP` in the
logs, re-check PayFast's current ranges and add them to `VALID_IPS`. (Other
failure modes log `[PayFast ITN] Invalid signature` or `validate returned
INVALID`.)

## Step 5 — Smoke test with real money

1. From a **real account** (not the merchant's own email — PayFast blocks
   buyer == merchant), play through: select course → choose stake (use the
   **R50** tier) → pay.
2. Complete the payment on PayFast's live page.
3. Confirm you're redirected to `/payment-return`.
4. Check production logs for the ITN line:
   `[PayFast ITN] ✅ Payment confirmed — gl_tier_1_… → pf:… (1 row(s) updated)`.
5. In Supabase, confirm the `bets` row exists with `status = 'active'` and
   `payment_intent_id` now holding the `pf_…` id.
6. In the admin panel (`/admin/bets`), confirm the bet shows up with the real amount.
7. Confirm the money landed in your PayFast account, then (optionally) refund the
   test transaction from the PayFast dashboard.

## Step 6 — Watch the first live transactions

For the first day, keep an eye on production logs for:
- `[PayFast ITN] Rejected — no valid IP` → IP allow-list issue (Step 4).
- `[PayFast ITN] Invalid signature` → passphrase mismatch between checkout and dashboard.
- `[PayFast ITN] DB update warning` / `service role key missing` → `SUPABASE_SERVICE_ROLE_KEY` not set in prod.

---

## Rollback

To return to sandbox instantly: set `PAYFAST_SANDBOX=true` and
`NEXT_PUBLIC_PAYFAST_SANDBOX=true` and redeploy. No code changes needed.
