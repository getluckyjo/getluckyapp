/**
 * Closed-beta gate (docs/pwa-plan.md).
 *
 * Off unless BETA_GATE=on. When on, the proxy lets a page view through if
 * the signed-in user's email is on the list, or the browser carries the
 * cookie set by redeeming an invite code at /beta. The list is one table,
 * beta_access, edited from /admin/beta; the check is the beta_check()
 * function from migration 016, so the list is never readable directly.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export const BETA_COOKIE = 'gl_beta'
export const BETA_COOKIE_MAX_AGE = 90 * 24 * 60 * 60

export function betaGateEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.BETA_GATE ?? '').trim().toLowerCase() === 'on'
}

/** Routes that stay reachable with the gate on: sign-in, marketing, legal, the gate itself, and plumbing. */
const OPEN_PREFIXES = [
  '/api/', '/admin', '/auth', '/beta', '/splash', '/onboarding', '/terms', '/privacy', '/responsible-play', '/install',
  '/witness', '/~offline', '/serwist', '/manifest.webmanifest', '/monitoring',
  // A tester already mid-payment must be able to come back from PayFast.
  '/payment-return', '/age-check', '/welcome',
]

export function betaGateApplies(pathname: string): boolean {
  if (pathname === '/') return false
  return !OPEN_PREFIXES.some(p => pathname === p || pathname.startsWith(p.endsWith('/') ? p : p + '/') || pathname.startsWith(p))
}

export function normaliseCode(code: string): string {
  return code.trim().toLowerCase()
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** True when either credential is on the list. Any client works; the function is security definer. */
export async function betaAllowed(
  client: Pick<SupabaseClient<Database>, 'rpc'>,
  { email, code }: { email?: string | null; code?: string | null },
): Promise<boolean> {
  if (!email && !code) return false
  const { data, error } = await client.rpc('beta_check', {
    p_email: email ? normaliseEmail(email) : null,
    p_code: code ? normaliseCode(code) : null,
  })
  if (error) throw error
  return data === true
}

/** Eight characters, unambiguous alphabet, e.g. "GL-7K4M9P2X". */
export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return `GL-${out}`
}
