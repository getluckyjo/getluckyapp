import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// ── Rate limiting (in-memory sliding window) ──────────────────────────────
interface RateEntry { count: number; resetAt: number }
const rateStore = new Map<string, RateEntry>()
let cleanupCounter = 0

const RATE_LIMITS: { pattern: string; limit: number; windowMs: number }[] = [
  { pattern: '/api/payments/payfast/notify', limit: 0, windowMs: 0 },     // EXEMPT — never rate-limit ITN
  { pattern: '/api/payments/payfast',        limit: 5,  windowMs: 60_000 },
  { pattern: '/api/bets/create',             limit: 10, windowMs: 60_000 },
  { pattern: '/api/videos/upload-url',       limit: 10, windowMs: 60_000 },
  { pattern: '/api/admin',                   limit: 30, windowMs: 60_000 },
]
const DEFAULT_API_LIMIT = 60
const DEFAULT_API_WINDOW = 60_000

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

function checkRateLimit(request: NextRequest, pathname: string): NextResponse | null {
  if (!pathname.startsWith('/api/')) return null

  // Find matching rule
  let limit = DEFAULT_API_LIMIT
  let windowMs = DEFAULT_API_WINDOW
  for (const rule of RATE_LIMITS) {
    if (pathname.startsWith(rule.pattern)) {
      if (rule.limit === 0) return null // exempt
      limit = rule.limit
      windowMs = rule.windowMs
      break
    }
  }

  const ip = getClientIp(request)
  const routeKey = RATE_LIMITS.find(r => r.limit > 0 && pathname.startsWith(r.pattern))?.pattern ?? '/api'
  const key = `${ip}:${routeKey}`
  const now = Date.now()
  const entry = rateStore.get(key)

  if (!entry || entry.resetAt < now) {
    rateStore.set(key, { count: 1, resetAt: now + windowMs })
  } else {
    entry.count++
    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      return NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      )
    }
  }

  // Lazy cleanup every ~100 requests
  if (++cleanupCounter >= 100) {
    cleanupCounter = 0
    for (const [k, e] of rateStore) { if (e.resetAt < now) rateStore.delete(k) }
  }

  return null
}

// ── Route config ──────────────────────────────────────────────────────────
// Reachable signed out. Marketing, legal, and the sign-in flow itself.
const PUBLIC_ROUTES = ['/splash', '/onboarding', '/auth', '/terms', '/privacy', '/responsible-play', '/app']

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
const DASHBOARD_ROUTES = ['/home', '/history', '/leaderboard', '/account', '/membership']

// The play flow. These REQUIRE a session.
//
// They used to be ungated, which meant a signed-out visitor could walk all the
// way to "Pay R50 & Play" and get a raw "Not authenticated" string from
// /api/payments/payfast — the API was right to refuse, the flow was wrong to let
// them get that far. Sign-in now happens before a stake is chosen, not after.
const PLAY_ROUTES = ['/select-course', '/choose-stake', '/record', '/confirm', '/result', '/verify']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Rate limiting check (API routes only) ───────────────────────────────
  const rateLimitResponse = checkRateLimit(request, pathname)
  if (rateLimitResponse) return rateLimitResponse

  // API routes and admin routes handle their own auth (admin in its layout and
  // handlers; API routes with getUser() per route).
  if (
    pathname === '/' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/auth/callback') ||
    PUBLIC_ROUTES.some(r => pathname.startsWith(r)) ||
    UNGATED_ROUTES.some(r => pathname.startsWith(r)) ||
    DASHBOARD_ROUTES.some(r => pathname.startsWith(r))
  ) {
    return NextResponse.next({ request })
  }

  // Skip auth gate if Supabase is not yet configured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!supabaseUrl || supabaseUrl.includes('YOUR_PROJECT_REF')) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
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
