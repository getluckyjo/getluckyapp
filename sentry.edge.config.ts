import * as Sentry from '@sentry/nextjs'

// Edge runtime. Nothing in this app is pinned to the edge today, but Next may
// run the proxy there; keep it configured so it is never silent.
Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
})
