/**
 * Service worker source. Bundled by esbuild inside src/app/serwist/[path]/route.ts
 * (Serwist under Turbopack) and served at /serwist/sw.js with scope "/".
 *
 * The caching table in docs/pwa-plan.md is the contract. In one line: hashed
 * static assets and brand files are cache-first, page shells are
 * stale-while-revalidate, route payloads are network-first, and anything
 * that carries a session, money or personal data is network-only and listed
 * here by name so nobody has to infer it.
 */
import {
  CacheFirst,
  CacheableResponsePlugin,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type RuntimeCaching,
  type SerwistGlobalConfig,
} from 'serwist'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}
declare const self: ServiceWorkerGlobalScope

const DAY = 24 * 60 * 60
const YEAR = 365 * DAY

/**
 * Never served from cache, whatever the request looks like. Same-origin
 * paths are matched by prefix.
 *
 *   /api            every data call; most carry a session, some carry money
 *   /auth/callback  the OAuth / magic-link exchange
 *   /auth/confirm   the token_hash exchange
 *   /payment-return PayFast lands the payer here and the bet row is created
 *   /admin          reviewer screens
 *   /witness        one-time confirmation tokens
 *   /beta           invite-code redemption sets a cookie
 *   /monitoring     Sentry tunnel
 *   /serwist        the worker itself
 */
const NETWORK_ONLY_PATHS = [
  '/api/',
  '/auth/callback',
  '/auth/confirm',
  '/payment-return',
  '/admin',
  '/witness/',
  '/beta',
  '/monitoring',
  '/serwist/',
]

/** Third parties that hold sessions or money. Fonts are the only cross-origin thing we cache. */
const NETWORK_ONLY_HOSTS = [/\.supabase\.co$/i, /\.supabase\.in$/i, /payfast\.co\.za$/i, /\.sentry\.io$/i, /^sentry\.io$/i]

function isNetworkOnly(url: URL, sameOrigin: boolean): boolean {
  if (sameOrigin) return NETWORK_ONLY_PATHS.some(p => url.pathname === p.replace(/\/$/, '') || url.pathname.startsWith(p))
  return NETWORK_ONLY_HOSTS.some(re => re.test(url.hostname))
}

/** Next's client-side navigation fetches a route payload rather than HTML. */
function isRscRequest(request: Request, url: URL): boolean {
  return request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')
}

const runtimeCaching: RuntimeCaching[] = [
  // ── 1. The deny list, first, so nothing below can claim these ────────────
  {
    matcher: ({ url, sameOrigin }) => isNetworkOnly(url, sameOrigin),
    handler: new NetworkOnly(),
  },

  // ── 2. Hashed build output: immutable, cache-first ───────────────────────
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/_next/static/'),
    handler: new CacheFirst({
      cacheName: 'next-static',
      plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: YEAR })],
    }),
  },

  // ── 3. Fonts: Google Fonts CSS + files, and the self-hosted display face ──
  {
    matcher: ({ url }) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com',
    handler: new CacheFirst({
      cacheName: 'fonts',
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: YEAR }),
      ],
    }),
  },
  {
    matcher: ({ url, sameOrigin }) =>
      sameOrigin && (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/brand/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/splash/')),
    handler: new CacheFirst({
      cacheName: 'brand',
      plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: YEAR })],
    }),
  },

  // ── 4. Photos: marketing images and the image optimiser ──────────────────
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && (url.pathname.startsWith('/marketing/') || url.pathname.startsWith('/_next/image')),
    handler: new StaleWhileRevalidate({
      cacheName: 'images',
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * DAY }),
      ],
    }),
  },

  // ── 5. Route payloads: network-first so a returning user never gets a stale tree
  {
    matcher: ({ url, request, sameOrigin }) => sameOrigin && isRscRequest(request, url),
    handler: new NetworkFirst({
      cacheName: 'pages-rsc',
      networkTimeoutSeconds: 3,
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: DAY }),
      ],
    }),
  },

  // ── 6. Page shells: stale-while-revalidate ───────────────────────────────
  // Every page is a client component that fetches its data from /api after
  // mount, so the HTML is the same for every user. `/` is excluded: it reads
  // the session cookie and redirects, and must always do so live.
  {
    matcher: ({ url, request, sameOrigin }) =>
      sameOrigin && request.mode === 'navigate' && url.pathname !== '/' && !isRscRequest(request, url),
    handler: new StaleWhileRevalidate({
      cacheName: 'pages',
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: DAY }),
      ],
    }),
  },
]

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    // Hashed URLs never need a cache-busting query.
    ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^source$/],
    cleanupOutdatedCaches: true,
  },
  // A new worker waits until the golfer taps "Update" in the toast. Reloading
  // under someone mid-claim is worse than one more session on the old build.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  disableDevLogs: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: '/~offline',
        matcher: ({ request }) => request.destination === 'document',
      },
    ],
  },
})

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

serwist.addEventListeners()
