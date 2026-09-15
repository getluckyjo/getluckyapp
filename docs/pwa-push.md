# Push notifications: deferred to after beta

The brief asked for web push behind a feature flag, off by default, with
an honest call on complexity. The call: **defer.** Here is why, what it
would take, and what is already in place so it can be added without
rework.

## Why not now

1. **iOS needs 16.4+ and the app on the home screen.** `PushManager` does not exist in Safari tabs at all, and on an installed app it only appears from iOS 16.4. Roughly a third of the beta group will be on older phones or testing in Safari, and for them the feature is invisible.
2. **The sending side is real work.** VAPID keys in the environment, a `push_subscriptions` table (endpoint, keys, user, device, created/last-used), an outbox job kind that fans a notification out to a user's devices with `web-push`, expiry handling for dead endpoints (410), and an admin or event hook that decides what to send.
3. **There is nothing to send yet that email does not already cover.** Claim verified, payout made, witness confirmed: each already produces an email, and each is a once-a-week event for a golfer. A permission prompt that earns a "no" is worse than no prompt: the browser remembers the refusal.
4. **Permission UX has to be designed, not bolted on.** The only honest moment is after a claim is submitted ("Want to know the moment your claim is verified?"). That screen exists (`/verify`), but the copy, the toggle and the fallback need a design pass.

## What is already in place

- The service worker (`src/app/sw.ts`) is the file a `push` and `notificationclick` handler would be added to.
- The outbox (`src/lib/outbox.ts`) is where a `push_notify` job kind slots in next to `witness_request`, `welcome_email` and `feedback_email`.
- `useIsStandalone()` gives the gate for showing the prompt only where it can work.
- Analytics events exist for measuring the ask (`session_start` with `standalone`).

## Plan when it is picked up (about a day)

1. Migration `017_push.sql`: `push_subscriptions (id, user_id, endpoint unique, p256dh, auth, user_agent, created_at, last_used_at, failed_at)`, RLS, no client access.
2. Env: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:). Generated once with `npx web-push generate-vapid-keys`.
3. `POST /api/push/subscribe` and `DELETE`, authenticated, rate-limited.
4. `sw.ts`: `push` handler showing `{ title, body, url }`; `notificationclick` focusing or opening `url`.
5. Outbox job `push_notify({ userId, title, body, url })` using `web-push`; 410/404 marks the subscription failed.
6. Hooks: claim verified, claim rejected (with reason), payout sent.
7. UI: a toggle on `/verify` after submission and on Account, shown only when `useIsStandalone()` and `'PushManager' in window`.
8. Feature flag `NEXT_PUBLIC_PUSH=on`, default off, so beta builds ship the code dark.
