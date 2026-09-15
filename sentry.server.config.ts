import * as Sentry from '@sentry/nextjs'

// Server runtime (route handlers, server components, proxy). Loaded from
// src/instrumentation.ts. With no DSN this is a no-op, so local dev and CI
// builds never send anything.
Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  initialScope: { tags: { build_date: process.env.NEXT_PUBLIC_BUILD_DATE ?? 'unknown' } },
  tracesSampleRate: process.env.VERCEL_ENV === 'production' ? 0.2 : 1.0,
  // No PII by default: request bodies and user emails stay out of events.
  sendDefaultPii: false,
  beforeSend(event) {
    // Belt and braces: never ship a PayFast signature, a token, or a key.
    const scrub = (s: string) => s.replace(/(signature|token|token_hash|api[_-]?key|passphrase|authorization)=([^&\s]+)/gi, '$1=[redacted]')
    if (event.request?.url) event.request.url = scrub(event.request.url)
    if (event.request?.query_string && typeof event.request.query_string === 'string') {
      event.request.query_string = scrub(event.request.query_string)
    }
    return event
  },
})
