# Get Lucky — testing guide for the first golfers

The launch is open: there is no closed beta and no invite list. This guide
is for the first small group of golfers Johannes asks to try the app, and
for Johannes running that. Everything here works on a normal phone with no
app store. The invite-code and gate mechanics further down exist in the
code and stay off unless a closed test is ever wanted.

## Before you start

The app runs at `https://www.getluckyholeinone.com`. Entries are real:
a bet costs what it says on the screen and goes through the real PayFast
checkout. A hole-in-one is a real claim, so play it straight.

## Install on Android (Chrome)

1. Open the link in **Chrome**.
2. Use the app for a minute: open Winners or My bets. A card appears at the bottom, "Add Get Lucky to your home screen". Tap **Install**.
3. If the card does not appear: tap the three-dot menu (top right) → **Add to Home screen** (on some phones: **Install app**) → **Install**.
4. Find the green Get Lucky icon on your home screen and open it from there. It opens full screen with no browser bar.

Samsung Internet: menu → **Add page to** → **Home screen**.

## Install on iPhone (Safari only)

Only Safari can install web apps on iPhone. Chrome, Firefox, or a link opened
inside WhatsApp, Instagram or Gmail will not work: copy the link and paste
it into Safari first.

1. Open the link in **Safari**.
2. Tap the **Share** button: the square with an arrow pointing up, at the bottom centre of the screen.
3. Scroll the sheet down and tap **Add to Home Screen**.
4. Tap **Add** in the top right.
5. Close Safari and open **Get Lucky** from your home screen.

You will need to sign in once inside the installed app, even if you were
signed in in Safari; the installed app keeps its own session. Use the
six-digit code from the email, not the link.

Needs iOS 16.4 or later for the best experience; iOS 15 works but without
some of the offline behaviour.

## What to test

Do these in order once, then use the app as you normally would.

1. **Install** as above. Note whether the card or sheet appeared on its own, and whether the icon and splash screen look right.
2. **Sign in** inside the installed app with the six-digit code.
3. **Buy a bet** on the R50 tier with your own card; it is refunded afterwards. You should come back to the Record screen with a small buzz on Android.
4. **Record** a shot, declare the result, and for a "hole-in-one" go through the claim with a friend as witness. The witness gets an email with one question.
5. **Lock the phone** for 20 minutes, unlock, reopen the app: still signed in, same screen?
6. **Turn on airplane mode** and open the app from the icon: you should see the green "You're offline" screen with a Try again button, not a browser error. Turn airplane mode off: it should come back by itself.
7. **Pull down** on Home, Winners or My bets: the lime ball should drop and the list refresh.
8. **Update flow**: when a new build ships you will see "New version available" at the bottom. Tap Update. The app should reload onto the new build without losing your place.

## How to send feedback

If the build has the feedback button switched on: tap the small round **chat button** at the bottom right of any screen
(it is not on the camera screen). Write what you were doing and what you
expected. The message goes straight to Johannes with the screen you were
on, your phone model, and the build number, so you do not need to add
those.

If the app will not open at all, email johannes@getluckygolfclub.com with
your phone model and a screenshot.

## How to report a bug well

- What you tapped, in order.
- What you expected, and what happened instead.
- A screenshot or screen recording if you can.
- The build number: Account screen, at the very bottom ("build abc1234 · 16 Sep 2026").

## Known limitations

- **iPhone: Chrome and in-app browsers cannot install.** Safari only.
- **No push notifications yet.** Claim updates arrive by email. Push is planned after the beta (see `docs/pwa-push.md`).
- **Offline is read-only.** You can open the app and see the last screens, but buying a bet, uploading a shot or submitting a claim needs signal. A recorded shot stays on the phone until the upload succeeds, but only while the app stays open.
- **Video upload on a weak signal** can take a few minutes. Keep the app in the foreground until the claim screen says it is submitted.
- **The desktop view** shows a phone-shaped frame; that is by design for reviewers, not a bug.

## For the person running the first group (and the gate, if ever used)

- **The launch is open; the gate is not used.** The first group plays on the live site like anyone else. Everything below about the gate and invite codes is there if a closed test is ever wanted.
- **Both beta features are off by default.** The app launches looking launched: no gate, no feedback button. Turn them on only for a closed test.
- **Turn the gate on**: Vercel → project → Settings → Environment Variables → `BETA_GATE` = `on` (Production) → Redeploy. Add your own email at `/admin/beta` **before** you do this; admins are not exempt.
- **Show the feedback button**: `NEXT_PUBLIC_FEEDBACK` = `on`, then redeploy (it is baked in at build time).
- **Add a tester**: `/admin/beta` → Email address → Add. Or Invite code → Create code, then copy the code to them. Removing a row locks them out on their next page view.
- **Apply migration 016** to the database first (`supabase/migrations/016_beta.sql`), the same way as 002 to 015.
- **Read feedback**: it arrives by email (subject starts "Beta feedback #"), and sits in the `feedback` table.
- **Watch installs and funnel**: Vercel → project → Analytics (enable it once). Events: `pwa_install`, `session_start` (with `standalone`), `course_selected`, `stake_chosen`, `payment_started`, `bet_created`, `result_declared`, `claim_submitted`, `feedback_sent`.
- **Ship an update**: merge to main as usual. Open apps see the toast within a minute of coming to the foreground.
- **Regenerate icons or splash screens** after a logo change: `npm run pwa:assets`, commit the output.

## Verification record

Lighthouse (mobile emulation, throttled, production build, no database
attached) on this branch versus main:

| Page | Metric | Before (main) | After (this branch) |
|---|---|---|---|
| `/home` | Performance | 77 | 83 |
| `/home` | LCP | 5.0 s | 4.4 s |
| `/home` | Total blocking time | 192 ms | 90 ms |
| `/home` | Accessibility | 100 | 100 |
| `/home` | Best practices | 96 | 96 |
| `/home` | SEO | 92 | 92 |
| `/splash` | Performance | 78 | 82 |
| `/splash` | LCP | 5.3 s | 4.3 s |
| `/splash` | Accessibility | 100 | 100 |
| `/splash` | Best practices | 96 | 96 |

CLS is 0.000 on both pages, both builds. Lighthouse 13 no longer has a PWA
category; installability is covered by the checks in the next section.

**Performance target (≥ 90 mobile) is not met yet: 83.** The gap is not
the PWA layer, it is page weight under Lighthouse's throttled 4G and 4×
CPU slowdown: about 250 KB of JavaScript on first load (the Sentry
browser SDK and the Supabase client are the two largest chunks, 53% and
82% unused on the home screen respectively) and the full-bleed hero
photo. Also note this sandbox blocks fonts.googleapis.com, so the "before"
run paid a blocked render-blocking request that production does not. What
this pass did for performance: the Google Fonts stylesheet no longer
blocks first paint, the display font is preloaded, the 192 px favicon
that Chrome fetched at high priority on every page is gone, and tab routes
are prefetched. Follow-ups that should close the gap, in order of payoff:

1. Lazy-load the Sentry browser SDK after first interaction (or drop
   `browserTracingIntegration` on the client): about 100 KB.
2. Serve the hero at the sizes the phone needs (`sizes="480px"` is
   already there; add `fetchPriority="high"`) and trim `hero-bg.webp`
   (344 KB source).
3. Split the admin chunk out of the shared bundle; it is loaded for golfers
   who never see it.

Installability checks (manifest, icons, service worker, offline response)
and the device checks in "What to test" are recorded in
`docs/pwa-verification.md`, with what was run here and what still needs a
real phone.
