# Sessions in the installed app

What happens to a golfer's sign-in when the app is backgrounded, force-quit,
or left alone for a week, and what the code does about it. Written for the
beta; re-check against real devices in the first week.

## How the session is stored

- `@supabase/ssr` keeps the session in **cookies** (`sb-<ref>-auth-token`, chunked), not localStorage. The browser client, the server components, the route handlers and the proxy all read the same cookie.
- The access token lives one hour. `supabase-js` refreshes it itself (`autoRefreshToken`) with a timer while the page is open and on `visibilitychange` when the app comes back to the foreground. `AuthContext` subscribes to `onAuthStateChange`, so the UI follows.
- The refresh token is long-lived. Supabase rotates it on each refresh and, by default, keeps a rotated token valid for a short reuse window so a race between two tabs does not sign everyone out.

## Case by case

| Situation | What happens | Golfer sees |
|---|---|---|
| **Backgrounded** (switch app, lock phone) for minutes or hours | The page is frozen, not closed. On return, `supabase-js` sees the tab become visible, refreshes the access token if it is near expiry, and fires `TOKEN_REFRESHED`. In-memory state (bet context, the recorded video blob) is intact. | Nothing. They are where they left off. |
| **Force-quit**, or iOS/Android evicts the page for memory | The page reloads from scratch on next open. Cookies persist, so `getSession()` returns the session and `AuthContext` restores the user. In-memory state is gone: the play flow keeps its cross-page state in `localStorage.pf_pending` (PayFast leg) and the bet id in `BetContext`, which is rebuilt from `/api/bets` on `/verify`. A recording that had not uploaded is lost. | Signed in. If they were on `/record`, they land on Home and the active bet shows the claim notice. |
| **iOS 7-day storage cap** (Safari ITP) | Applies to script-writable storage in the *browser* after seven days without a visit. Home-screen web apps are exempt from the cap on iOS 16.4+; the cookie the session lives in is set by the server, which the cap never touched anyway. | Nothing in the installed app. In Safari after a long gap, at worst a fresh sign-in. |
| **Refresh token expired or revoked** (password reset, admin sign-out, very long absence) | `getUser()` fails; `onAuthStateChange` fires `SIGNED_OUT`. The proxy redirects the next gated navigation to `/auth?next=/select-course`. | Sign-in screen. Six-digit code by email, no link needed. |
| **Signed in in Safari, then installed** | The installed app has its own cookie jar. The Safari session does not carry over. | Sign-in once inside the installed app. The code flow makes this a 30-second job. |
| **Offline** | Cookies do not need the network. The shell loads from the worker's cache; data calls fail until the signal returns and the screens show their empty/error states. | The screen, without its numbers. Pull to refresh when back online. |

## The one rule for the play flow

A golfer on a tee must never be dumped to a login screen mid-challenge. The
flow already respects this:

- `/record`, `/confirm` and `/result/*` are client screens; nothing on them re-checks the session until an API call is made.
- The upload URL is requested at the moment of upload (`/api/videos/upload-url`), which is the first place a dead session would surface. The route answers 401; the screen shows "Sign in again to save your shot" with the video still in memory, and the sign-in code flow returns them to the same screen.
- `/payment-return` is ungated in the proxy for exactly this reason: a cookie that went stale during the PayFast detour must not cost anyone their money.

## What to verify on real phones in week one

1. Install, sign in, buy a bet in sandbox, lock the phone for 30 minutes, unlock: still signed in, still on the same screen.
2. Same, but force-quit the app: reopens signed in.
3. Leave a test phone untouched for eight days: reopens signed in (iOS and Android).
4. Change the account password from a laptop: the phone is signed out on its next API call and lands on the code screen with `next` set.

Findings go into `BETA-TESTING.md` under "Known behaviour".
