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
  // Relative to the working directory. `.next/...` entries are rewritten to
  // /_next/... and `public/...` entries to / by the package.
  globDirectory: '.',
  globPatterns: [
    '.next/static/chunks/**/*.{js,css}',
    '.next/static/css/**/*.css',
    '.next/static/media/**/*.{woff2,woff,otf,ttf}',
    'public/fonts/*.otf',
    'public/brand/logo-corner.svg',
    'public/brand/logo-lockup.svg',
    'public/icons/icon-192.png',
  ],
  globIgnores: ['**/*.map', '.next/static/development/**', '.next/static/chunks/**/*.hot-update.*'],
  dontCacheBustURLsMatching: /^\/_next\/static\//,
  maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
  // The offline fallback page is rendered by Next, not a file on disk, so it
  // is added by hand with the build as its revision.
  additionalPrecacheEntries: [
    { url: '/~offline', revision: process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now()) },
  ],
})
