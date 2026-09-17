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

export function safeNext(raw: string | null | undefined): string {
  return raw && SAFE_NEXT_PATHS.includes(raw) ? raw : '/welcome'
}
