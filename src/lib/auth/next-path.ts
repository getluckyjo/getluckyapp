/**
 * Where a sign-in is allowed to land.
 *
 * Client-safe on purpose: the sign-in screen redirects on `?next=` too, so it
 * needs the same allow-list the server uses. Anything not on it falls back to
 * /welcome, so a crafted `next` can never become an open redirect — neither
 * off-site, nor onto a screen that expects state this session does not have.
 */
export const SAFE_NEXT_PATHS = [
  '/welcome', '/home', '/history', '/leaderboard', '/account', '/select-course', '/icons', '/admin',
]

/**
 * A golf day's link, /golf-day/<slug> (src/lib/golf-days/rules.ts): the
 * player signs in from it and must come back to it to join. The whole path
 * is matched, so a slug is the only thing that varies.
 */
const GOLF_DAY_PATH = /^\/golf-day\/[a-z0-9-]{2,40}$/

export function isGolfDayPath(path: string): boolean {
  return GOLF_DAY_PATH.test(path)
}

export function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/welcome'
  return SAFE_NEXT_PATHS.includes(raw) || GOLF_DAY_PATH.test(raw) ? raw : '/welcome'
}
