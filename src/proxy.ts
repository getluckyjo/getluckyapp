import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { Database } from '@/types/database'
import { BETA_COOKIE, betaAllowed, betaGateApplies, betaGateEnabled } from '@/lib/beta'

// ── Route config ──────────────────────────────────────────────────────────
// Reachable signed out. Marketing, legal, and the sign-in flow itself.
// /witness is the one-question page a named witness reaches from their email; they have no account.
// PWA plumbing is public too: the worker script, the manifest, and the offline
// fallback the worker serves when a page cannot be fetched.
// /monitoring is the Sentry tunnel (next.config.ts): a POST from a signed-out
// browser must reach Sentry, not be 307'd into a POST /auth that answers 405.
const PUBLIC_ROUTES = ['/splash', '/onboarding', '/auth', '/terms', '/privacy', '/responsible-play', '/install', '/witness', '/serwist', '/manifest.webmanifest', '/~offline', '/monitoring']

// Reachable signed out because the app still shows something useful, or because
// bouncing would be worse than letting them through:
//   /payment-return — PayFast returns the payer here and the bet row is created
//     here. Gating it means a cookie that went stale during the checkout detour
//     costs someone their money. It handles its own missing-session errors.
//   /age-check      — reached by redirect straight from /auth/callback. Gating it
//     turns a slow cookie write into a redirect loop back to /auth.
//   /welcome        — the "All set" beat, also reached straight from the
//     callback, so the same cookie-timing argument applies. It sends a
//     visitor with no session back to /auth itself.
const UNGATED_ROUTES = ['/payment-return', '/age-check', '/welcome']

// Dashboard surfaces. Public today: /leaderboard is a shop window, and /home
// renders a signed-out state. Left as they are — see the note on /account below.
// /golf-day/<slug> is a golf day's link: a player meets it before signing in,
// and the screen shows the day and a sign-in button to a signed-out visitor.
const DASHBOARD_ROUTES = ['/home', '/history', '/leaderboard', '/account', '/icons', '/golf-day']

// The play flow. These REQUIRE a session.
//
// They used to be ungated, which meant a signed-out visitor could walk all the
// way to "Pay R50 & Play" and get a raw "Not authenticated" string from
// /api/payments/payfast — the API was right to refuse, the flow was wrong to let
// them get that far. Sign-in now happens before a stake is chosen, not after.
const PLAY_ROUTES = ['/select-course', '/choose-stake', '/record', '/confirm', '/result', '/verify']

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl

  // ── Stray sign-in credentials on the root ───────────────────────────────
  // Supabase sends the browser to its configured Site URL — this origin's
  // root — when the redirect it was asked for is not on the project's
  // allow-list (www vs bare domain, a preview host) or an old email template
  // still points at it. Forward the credential to the route that can use it
  // instead of dropping it on the landing page.
  if (pathname === '/') {
    if (searchParams.has('code')) {
      const url = request.nextUrl.clone()
      url.pathname = '/auth/callback'
      return NextResponse.redirect(url, 307)
    }
    if (searchParams.has('token_hash')) {
      const url = request.nextUrl.clone()
      url.pathname = '/auth/confirm'
      if (!url.searchParams.has('type')) url.searchParams.set('type', 'magiclink')
      return NextResponse.redirect(url, 307)
    }
  }

  // Rate limiting lives in the API routes themselves (src/lib/rate-limit.ts),
  // backed by Postgres. An in-memory limiter here limited nothing on Vercel.

  // ── Closed beta ─────────────────────────────────────────────────────────
  // With BETA_GATE=on, every app screen needs an allow-listed email or a
  // redeemed invite code (src/lib/beta.ts). Sign-in, marketing, legal, the
  // gate page and the PayFast return stay open. Off by default.
  const gated = betaGateEnabled() && betaGateApplies(pathname)

  // API routes and admin routes handle their own auth (admin in its layout and
  // handlers; API routes with getUser() per route).
  if (
    !gated && (
      pathname === '/' ||
      pathname.startsWith('/api/') ||
      pathname.startsWith('/admin') ||
      pathname.startsWith('/auth/callback') ||
      PUBLIC_ROUTES.some(r => pathname.startsWith(r)) ||
      UNGATED_ROUTES.some(r => pathname.startsWith(r)) ||
      DASHBOARD_ROUTES.some(r => pathname.startsWith(r))
    )
  ) {
    return NextResponse.next({ request })
  }

  // Without a Supabase URL there is no session to check; let the page render
  // its signed-out state rather than crashing in the proxy.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!supabaseUrl) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (gated) {
    const code = request.cookies.get(BETA_COOKIE)?.value ?? null
    let allowed = false
    try {
      allowed = await betaAllowed(supabase, { email: user?.email ?? null, code })
    } catch {
      // The gate must fail closed, but a broken lookup should send the tester
      // to the gate page, not to a 500.
      allowed = false
    }
    if (!allowed) {
      const url = request.nextUrl.clone()
      url.pathname = '/beta'
      url.search = ''
      url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }
    // Allowed: the dashboard routes are public otherwise, so stop here for them.
    if (DASHBOARD_ROUTES.some(r => pathname.startsWith(r))) return supabaseResponse
  }

  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    url.search = ''
    // Carry the intent through sign-in. Anywhere in the play flow comes back to
    // the top of it: /choose-stake and beyond need bet state this session no
    // longer has, so landing there would only bounce again.
    if (PLAY_ROUTES.some(r => pathname.startsWith(r))) {
      url.searchParams.set('next', '/select-course')
    }
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export default proxy

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|otf|ttf|woff|woff2)$).*)',
  ],
}
