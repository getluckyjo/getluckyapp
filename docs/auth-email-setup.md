# Sign-in: Supabase settings and the branded auth email

The app has three doors in: Google, Facebook and email (a six-digit code plus
a sign-in button). All three end at `/auth/callback` or `/auth/confirm` and
then run the same post-sign-in steps (`src/lib/auth/finish-sign-in.ts`).

Two things live outside this repo and have to be set in the Supabase
dashboard for sign-in to work on the live site. Both took the app down in
September 2026 in exactly the ways described below.

---

## 1. Redirect URLs (why Google "did nothing")

Supabase only sends a browser back to a URL on the project's allow-list. If
the URL the app asked for is not listed, Supabase silently falls back to the
**Site URL** and the sign-in code is lost. The app now rescues a code that
lands on `/`, but the fix is to list every host the app is reached on.

**Supabase → Authentication → URL Configuration**

Site URL:

```
https://www.getluckyholeinone.com
```

Redirect URLs (add each line):

```
https://www.getluckyholeinone.com/**
https://getluckyholeinone.com/**
https://get-lucky-golf.vercel.app/**
https://*-get-lucky-golf-club.vercel.app/**
http://localhost:3000/**
```

The wildcard entries cover preview deployments. Without them, sign-in works
on `www.` but not on the bare domain or on a preview, which is what the
production logs showed on 15 September: one attempt reached
`/auth/callback` and succeeded, the next never reached it and landed on `/`.

---

## 2. Send Email hook (why magic links "never arrived")

Out of the box Supabase sends auth emails itself, through a shared mailer
that is rate-limited to a handful of messages per hour and uses an unbranded
template. None of those emails appear in Resend, which is how we know that
is what was happening.

With the **Send Email hook** enabled, Supabase instead POSTs the one-time
token to this app, and the app sends the V2-designed email through Resend
from the verified `getluckygolf.co.za` domain. The email carries a six-digit
code (typed into the sign-in screen, so it works on any device and survives
mail-provider link scanners) and a sign-in button.

**Supabase → Authentication → Hooks → Send Email hook**

| Setting | Value |
|---|---|
| Enabled | on |
| Type | HTTPS |
| URL | `https://www.getluckyholeinone.com/api/auth/send-email` |
| Secret | generate one in the dashboard, then copy it (it looks like `v1,whsec_…`) |

**Vercel → get-lucky-golf → Settings → Environment Variables**

| Variable | Value | Notes |
|---|---|---|
| `SEND_EMAIL_HOOK_SECRET` | the secret from the hook | Required. Requests that fail the signature check are refused and nothing is sent. |
| `RESEND_API_KEY` | existing | Already used by the welcome email. |
| `RESEND_FROM_ADDRESS` | `Get Lucky Golf <noreply@getluckygolf.co.za>` | Optional; this is the default. |
| `NEXT_PUBLIC_SITE_URL` | `https://www.getluckyholeinone.com` | The email's button and logo are built from this. |

Redeploy after adding the secret (environment variables are read at build
and start time).

Once the hook is on, Supabase's own email templates are no longer used for
any auth email: sign-in code, sign-up confirmation, password reset, invite,
email change and re-authentication all go through this app.

**Supabase → Authentication → Providers → Email**: leave "Confirm email"
on or off as before; either way the hook renders the message.

---

## 3. Facebook (optional)

The Facebook tile calls Supabase's Facebook provider. Enable it under
**Authentication → Providers → Facebook** with a Meta app ID and secret, and
add `https://<project-ref>.supabase.co/auth/v1/callback` to the Meta app's
valid OAuth redirect URIs. Until then the tile shows a "use Google or email"
message and does no harm.

---

## How the email flow works

1. Golfer enters their address on `/auth`. The app calls
   `supabase.auth.signInWithOtp`.
2. Supabase calls `POST /api/auth/send-email` with a signed payload
   containing the six-digit `token`, a `token_hash`, and the action type.
3. The app verifies the signature (`src/lib/email/standard-webhooks.ts`),
   renders the email (`src/lib/email/auth-emails.ts`) and sends it via Resend.
4. Golfer either types the code on `/auth` (client-side `verifyOtp`, then a
   full navigation to `/auth/callback` so the server runs the post-sign-in
   steps), or taps the button, which opens `/auth/confirm` and one more tap
   POSTs the `token_hash` to `/auth/confirm/verify`.
5. Either way `finishSignIn` marks onboarding done, fires the welcome email
   for a first-timer, sends anyone unverified to `/age-check`, and lands
   everyone else on `/welcome`.

To preview the email locally without sending: `npx tsx scripts/preview-auth-email.mts`
writes the rendered HTML to `/tmp/auth-email-preview.html`.
