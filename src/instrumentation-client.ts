/**
 * Browser runtime. Captures unhandled errors in the play flow (camera,
 * upload, PayFast return) that would otherwise only exist in a golfer's
 * console.
 *
 * Sentry's browser bundle is the largest thing on every screen's first
 * paint, and on a golf course the first paint is what matters. It is
 * loaded after the page has settled (window load, then an idle moment)
 * rather than with the app. Errors thrown before it is ready are held and
 * handed over once it is, so nothing from the first seconds is lost.
 */
type Sentry = typeof import('@sentry/nextjs')

type Held =
  | { kind: 'error'; error: unknown; message: string }
  | { kind: 'rejection'; reason: unknown }
  | { kind: 'transition'; href: string; navigationType: string }

const held: Held[] = []
let sentry: Sentry | null = null
let loading: Promise<void> | null = null

function onError(event: ErrorEvent) {
  if (sentry) return
  held.push({ kind: 'error', error: event.error, message: event.message })
}
function onRejection(event: PromiseRejectionEvent) {
  if (sentry) return
  held.push({ kind: 'rejection', reason: event.reason })
}

function replay(s: Sentry) {
  for (const h of held.splice(0)) {
    if (h.kind === 'error') s.captureException(h.error instanceof Error ? h.error : new Error(h.message))
    else if (h.kind === 'rejection') s.captureException(h.reason instanceof Error ? h.reason : new Error(String(h.reason)))
    else s.captureRouterTransitionStart(h.href, h.navigationType)
  }
}

function load(): Promise<void> {
  if (loading) return loading
  loading = import('@sentry/nextjs').then(s => {
    s.init({
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
    sentry = s
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    replay(s)
  }).catch(() => { /* blocked or offline: the next load() call tries again */ loading = null })
  return loading
}

if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SENTRY_DSN) {
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  const whenIdle = () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => { void load() }, { timeout: 5_000 })
    else setTimeout(() => { void load() }, 2_000)
  }
  if (document.readyState === 'complete') whenIdle()
  else window.addEventListener('load', whenIdle, { once: true })
}

/** Next calls this on every client navigation; Sentry's own hook once it is loaded. */
export function onRouterTransitionStart(href: string, navigationType: string): void {
  if (sentry) sentry.captureRouterTransitionStart(href, navigationType)
  else if (held.length < 50) held.push({ kind: 'transition', href, navigationType })
}
