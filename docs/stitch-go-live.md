# Stitch Go-Live: Apple Pay and Google Pay in the app

Stitch (stitch.money) carries Apple Pay and Google Pay for Get Lucky Golf.
The wallet sheet opens on the stake sheet itself: Face ID, done, record.
PayFast keeps cards, Instant EFT and the PayFast saved card; nothing about
those changes. Until every variable below is set, the app behaves exactly
as before (a device with Apple Pay gets the button to PayFast's hosted
page, everyone else the modal), so this can ship ahead of onboarding.

> Real money once the live client is in. Test the full flow with a real
> R50 Apple Pay entry on a phone before announcing it.

## How it works

1. **The sheet** (`src/components/pay/WalletButtons.tsx`). Apple Pay is
   Safari's own `ApplePaySession`; Google Pay is Google's `pay.js`, loaded
   only when configured. Both are asked for exactly the tier amount in rand,
   Visa and Mastercard, 3-D Secure capable (`src/lib/stitch/public.ts`).
2. **Apple merchant validation** `POST /api/payments/wallet/validate`.
   Safari hands the page a validation URL; the server asks Stitch
   (`validateApplePayMerchant`) for the merchant session. Signed-in golfers
   only, our own host only, apple.com URLs only.
3. **The charge** `POST /api/payments/wallet/charge`. The wallet's token
   (only Stitch can decrypt it) goes to `initiateTransaction` with our
   `gl_` reference. The ledger row (`payfast_payments`, `provider =
   'stitch'`, migration 045) is written **before** Stitch is asked, so the
   webhook can only ever attach the money to the hole the golfer chose.
   Success completes the row and grants the bet there and then; a refusal
   is `failed` and no bet; a 3-D Secure step (some Google Pay cards) sends
   the golfer to the bank page and back to `/payment-return`; no answer at
   all is `unknown`, never `failed`.
4. **The webhook** `POST /api/payments/stitch/webhook`. Stitch's word,
   delivered through Svix and verified against `STITCH_WEBHOOK_SECRET`.
   Every delivery id is remembered (`stitch_webhook_events`), so a retry
   does nothing twice. SUCCESS completes a pending or unknown row and grants
   the bet; FAILURE or CANCELLED fails it; a row already complete is left
   alone. A SUCCESS for the wrong amount is `amount_mismatch` with an ops
   alert and no bet.
5. **Reconciliation** (`src/lib/stitch/reconcile.ts`, on the every-minute
   outbox cron). Rows still `unknown` or `pending` after two minutes are
   looked up at Stitch by reference: confirmed → complete and granted; not
   found after ten minutes → failed; a 3-D Secure left open for a day →
   failed. Stitch unreachable → left for the next run.

The grant, the return page, Home's "paid shot is waiting" card and the
admin payments screens all key on the `gl_` reference, the same as PayFast.

## Step 1: the Stitch client

From Stitch onboarding you get a **client id** and a **client secret** for
the direct API (SSO/client-credentials). A test client's id starts with
`test-`; production refuses it, so:

| Variable | Where | Value |
|---|---|---|
| `STITCH_CLIENT_ID` | Preview: the test client. Production: the live client | from Stitch |
| `STITCH_CLIENT_SECRET` | same environment as its id; mark Sensitive | from Stitch |

Set them in Vercel → Project → Settings → Environment Variables. Never in
chat, never in the repo. The client needs the scopes `transaction_initiate`
and `client_webhook_manage` (ask Stitch if a token request is refused with
`invalid_scope`).

## Step 2: Apple Pay

Stitch classifies the client as low-risk web and then:

1. **Assigns an Apple merchant identifier** (`merchant.money.stitch.…`). Set
   it as `STITCH_APPLE_MERCHANT_IDENTIFIER` (server, both environments).
2. **Supplies the domain association file.** Paste its contents, as is,
   into `APPLE_PAY_DOMAIN_ASSOCIATION` (server). The app serves it at
   `/.well-known/apple-developer-merchantid-domain-association`; without the
   variable that path is a 404. Then give Stitch the domain to register:
   `www.getluckyholeinone.com` (and the preview host for the test client).
   Apple fetches the file during registration; check it with
   `curl https://www.getluckyholeinone.com/.well-known/apple-developer-merchantid-domain-association`.
3. **Switch the button on**: `NEXT_PUBLIC_STITCH_APPLE_PAY=on` (build-time,
   so redeploy after setting it). From then on a device with Apple Pay gets
   the in-app sheet instead of the hosted-page button.

`STITCH_DISPLAY_NAME` (optional) is what the sheet shows as the payee;
default "Get Lucky Golf".

## Step 3: Google Pay

1. From Stitch: the **gateway merchant id** for us →
   `NEXT_PUBLIC_STITCH_GATEWAY_MERCHANT_ID` (build-time). Setting it shows
   the Google Pay button on devices that have a card in Google Pay.
2. From the [Google Pay Business Console](https://pay.google.com/business/console):
   register the domain, get the **merchant id** →
   `NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID`. Google refuses a PRODUCTION
   request without one, so without it the button only renders in TEST.
3. `NEXT_PUBLIC_GOOGLE_PAY_ENV`: `TEST` or `PRODUCTION`. Default PRODUCTION
   on the production deployment, TEST elsewhere. TEST sheets return a
   token Stitch's test client accepts; no money moves.
4. `NEXT_PUBLIC_STITCH_GOOGLE_GATEWAY`: the name Google knows Stitch by in
   the tokenization spec. Default `stitch`; confirm with Stitch during
   onboarding and set it only if theirs differs.

Only device-bound tokens (`CRYPTOGRAM_3DS`) are requested: a PAN-only
token is a stored card number with no cryptogram, which Stitch does not
take for Google Pay.

## Step 4: the webhook

Subscribe once per environment with the client's own token:

```graphql
mutation { clientWebhookAdd(input: { url: "https://www.getluckyholeinone.com/api/payments/stitch/webhook", filterTypes: ["transaction"] }) { id url secret filterTypes } }
```

The `secret` (`whsec_…`) goes into `STITCH_WEBHOOK_SECRET` (server,
Sensitive). Production refuses to start Stitch without it. Rotating it:
Svix sends both signatures during the overlap and the app accepts either.

## Step 5: test, then live

With the test client in Preview:

- Apple Pay on an iPhone with a real card in Wallet: the test client
  authorises without moving money. Stitch's test amounts `1.01`, `2.02`,
  `3.03`, `4.04` simulate failures; a tier stake never lands on one.
- Google Pay in TEST with any card from Google's test suite.
- Watch the ledger: `select m_payment_id, provider, provider_ref, status,
  raw_payload from payfast_payments where provider = 'stitch' order by
  created_at desc`. Every row ends `complete` with a `bet_id`, or
  `failed`; nothing sits `unknown` beyond a few minutes.
- Send a signed test webhook (the Stitch dashboard can) and check
  `stitch_webhook_events` has its id once, however many times it is sent.

Then the live client in Production, redeploy (the `NEXT_PUBLIC_` values are
baked at build), and one real R50 entry.

## A card on the account (the fallback without a wallet)

A golfer with neither Apple Pay nor Google Pay can add a card once, under
Account → Payment → **Add a card**, and every entry after that is one
tap. Migration 046.

1. `POST /api/payments/card/stitch` creates a Stitch **payment consent
   request** (`paymentConsentRequestCreate`, scope
   `client_recurringpaymentconsentrequest`, an hour's expiry) and records
   its id against the golfer in `stitch_consent_requests`.
2. The golfer goes to Stitch's hosted page (`url` + our `redirect_uri`),
   types the card, and the bank runs 3-D Secure there. We never see the
   number.
3. Back on `GET /api/payments/card/stitch/return?id=…&status=…` nothing in
   the query string is believed: the id must be one this golfer started,
   and Stitch is asked (`node(id)` → `PaymentConsentGranted`). Granted →
   one `payment_cards` row, `provider = 'stitch'`, `token` = the consent
   id, label "Visa •••• 1234". Closed or failed → nothing. Stitch
   unreachable → Account says "being confirmed" and the webhook finishes.
4. The `payment-consent-request` webhook (same endpoint, same secret;
   add `"payment-consent-request"` to the subscription's `filterTypes`)
   attaches on GRANTED, removes the card on REVOKED or EXPIRED, closes the
   request on FAILED or CANCELLED.
5. One tap: the existing `/api/payments/payfast/charge` reads the card
   row's provider. A Stitch card is charged with `initiateTransaction`
   and `token` = the consent id, ledger row first (`provider = 'stitch'`),
   the same R250 stake and R2,500-a-day bounds. If Stitch's client-level
   3-D Secure rule asks for a step, the answer is 202 THREE_DS and the
   golfer goes to the bank and back to `/payment-return`.
6. Remove: `DELETE /api/payments/card` revokes the consent at Stitch
   (`paymentConsentRequestRevoke`) and deletes the row; the row goes even
   when Stitch cannot be reached, and the failure is logged.

Switch it on with `NEXT_PUBLIC_STITCH_CARDS=on` (build-time). It needs
the same `STITCH_CLIENT_ID` and secret as the wallets, plus:

- **The redirect domain allowlisted at Stitch**: `www.getluckyholeinone.com`
  for the live client and the preview host for the test client. Test
  clients allow `https://localhost:3000` by default; note the https, so
  local testing wants a tunnel or an allowlisted preview.
- **3-D Secure on consent charges**: ask Stitch what the client's rule is.
  Our bounds assume no step on the one-tap charge; if the client enforces
  it, every one-tap entry detours through the bank and back, which works
  but is not one tap.

The PayFast "Save my card" checkbox stays as it is; a golfer has one
saved card, whichever provider holds it, and the start route refuses a
second until the first is removed.

## Fees and settlement

Stitch Express: 2.95% ex VAT per wallet transaction (confirm on the
contract). Settlement is to the Stitch-linked bank account, separate from
PayFast's; the admin payments screen shows the provider per row so the two
statements reconcile apart.

## What Stitch does not do here

- **Cards typed in.** Still PayFast's modal (3-D Secure, Instant EFT).
- **The PayFast saved card.** Still PayFast's token; unchanged. A card
  added under Account is Stitch's (above).
- **Refunds.** The admin refund route is PayFast only. A Stitch refund is
  done from the Stitch dashboard for now; mark the ledger row by hand
  (`refunded_at`). A route can follow once there is one to do.
