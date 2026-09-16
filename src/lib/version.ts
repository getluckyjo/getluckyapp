/**
 * The build stamp. Vercel exposes the commit SHA at build time; the build
 * date is set in next.config.ts. Shown on the Account screen, sent with
 * every feedback submission, and tagged onto Sentry events, so a bug report
 * always says which build it came from.
 */
export const APP_VERSION = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)
export const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE ?? ''

export function buildLabel(): string {
  if (!BUILD_DATE) return APP_VERSION
  const d = new Date(BUILD_DATE)
  const when = Number.isNaN(d.getTime())
    ? BUILD_DATE
    : d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${APP_VERSION} · ${when}`
}
