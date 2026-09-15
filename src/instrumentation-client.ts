import * as Sentry from '@sentry/nextjs'

// Browser runtime. Captures unhandled errors in the play flow (camera, upload,
// PayFast return) that would otherwise only exist in a golfer's console.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  // Which build, and whether it ran as the installed app: on every event.
  initialScope: {
    tags: {
      build_date: process.env.NEXT_PUBLIC_BUILD_DATE ?? 'unknown',
      standalone: typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches ? 'true' : 'false',
    },
  },
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  sendDefaultPii: false,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
