import { createSerwistRoute } from '@serwist/turbopack'

/**
 * Serves the service worker at /serwist/sw.js (and its source map).
 *
 * @serwist/turbopack bundles src/app/sw.ts with esbuild at build time,
 * injects the precache manifest computed from the build output, and marks
 * the response `Service-Worker-Allowed: /` so a worker served from
 * /serwist/ can control the whole origin. `dynamic = "force-static"` means
 * this runs once during `next build`, not per request.
 */
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: 'src/app/sw.ts',
  useNativeEsbuild: true,
  // The glob patterns are left at the package defaults on purpose: they are
  // built from the Next config's resolved `distDir`, which Vercel changes at
  // build time (a hard-coded `.next/static/...` matched nothing there and the
  // worker shipped with five entries). Defaults cover `<distDir>/static/**`
  // and `public/**`; the ignores below keep the install small: no source
  // maps, no marketing photos, no launch images, no stray root files.
  globIgnores: [
    '**/*.map',
    '**/static/development/**',
    '**/*.hot-update.*',
    'public/marketing/**',
    'public/splash/**',
    'public/icons/**',
    'public/GLG_Indwe_FSP_Banner.png',
    'public/apple-icon.png',
    'public/favicon.png',
    'public/logo.png',
    'public/logo.svg',
    'public/brand/logo-lockup.png',
    'public/file.svg',
    'public/globe.svg',
    'public/next.svg',
    'public/vercel.svg',
    'public/window.svg',
  ],
  dontCacheBustURLsMatching: /^\/_next\/static\//,
  maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
  // The offline fallback page is rendered by Next, not a file on disk, so it
  // is added by hand with the build as its revision.
  additionalPrecacheEntries: [
    { url: '/~offline', revision: process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now()) },
  ],
})
