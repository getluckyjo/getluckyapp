/**
 * Rate limiting that actually works on Vercel.
 *
 * Each rule is a fixed window per key, counted atomically in Postgres by
 * `rate_limit_hit()` (migration 009) through the service role. Routes call
 * `enforceRateLimit(rule, { userId, ip })` after authentication; a limited
 * request gets a 429 with Retry-After.
 *
 * Per-user limits are tight (a person does not start eleven checkouts in ten
 * minutes). Per-IP limits are deliberately loose: a corporate day puts 120
 * golfers behind one clubhouse Wi-Fi address, and a limit that blocks them
 * costs more than it saves. The per-IP limit is there to blunt an anonymous
 * script, not to be the main control.
 *
 * Fails OPEN: if the counter cannot be reached the request is allowed and an
 * error is captured. A database blip must not turn into a self-inflicted
 * outage on the money path; Sentry will say the limiter is down.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'

export interface RateRule {
  /** Stable name; part of the counter key. */
  name: string
  /** Max hits per user per window. */
  perUser: number
  /** Max hits per IP per window (null = no IP limit). */
  perIp: number | null
  windowSeconds: number
}

const TEN_MINUTES = 600
const ONE_HOUR = 3600

export const RULES = {
  checkout:    { name: 'checkout',    perUser: 10,  perIp: 300,  windowSeconds: TEN_MINUTES } as RateRule,
  betCreate:   { name: 'bet_create',  perUser: 40,  perIp: 1200, windowSeconds: TEN_MINUTES } as RateRule, // the return page polls ~7×
  claim:       { name: 'claim',       perUser: 20,  perIp: 600,  windowSeconds: TEN_MINUTES } as RateRule,
  upload:      { name: 'upload',      perUser: 20,  perIp: 600,  windowSeconds: TEN_MINUTES } as RateRule,
  ageCheck:    { name: 'age_check',   perUser: 10,  perIp: 300,  windowSeconds: ONE_HOUR    } as RateRule,
  membership:  { name: 'membership',  perUser: 60,  perIp: null, windowSeconds: TEN_MINUTES } as RateRule,
  admin:       { name: 'admin',       perUser: 600, perIp: null, windowSeconds: TEN_MINUTES } as RateRule,
  accountDelete: { name: 'account_delete', perUser: 5, perIp: 100, windowSeconds: ONE_HOUR } as RateRule,
  authConfirm: { name: 'auth_confirm', perUser: 0,  perIp: 60,   windowSeconds: TEN_MINUTES } as RateRule, // pre-auth: IP only
  witness:     { name: 'witness',     perUser: 0,  perIp: 60,   windowSeconds: TEN_MINUTES } as RateRule, // public confirmation page: IP only
} as const

export interface RateScope {
  userId?: string | null
  ip?: string | null
}

/** Vercel sets x-forwarded-for to the real client; the first entry is the client. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0].trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

interface Hit { allowed: boolean; remaining: number; reset_at: string }

async function hit(key: string, limit: number, windowSeconds: number): Promise<Hit | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('rate_limit_hit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    if (!row || typeof row.allowed !== 'boolean') throw new Error('rate_limit_hit returned no row')
    return row as Hit
  } catch (err) {
    log.error('rate_limit.backend_unavailable', err, { key })
    return null
  }
}

/**
 * Returns a 429 response when the caller is over the rule's limit, otherwise
 * null. Checks the per-user limit first (when a user id is given), then the
 * per-IP limit (when an ip is given and the rule has one).
 */
export async function enforceRateLimit(rule: RateRule, scope: RateScope): Promise<NextResponse | null> {
  const checks: { kind: 'user' | 'ip'; id: string; limit: number }[] = []
  if (scope.userId && rule.perUser > 0) checks.push({ kind: 'user', id: scope.userId, limit: rule.perUser })
  if (scope.ip && rule.perIp) checks.push({ kind: 'ip', id: scope.ip, limit: rule.perIp })

  for (const c of checks) {
    const result = await hit(`${rule.name}:${c.kind}:${c.id}`, c.limit, rule.windowSeconds)
    if (!result) continue // backend down: fail open, already logged
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((Date.parse(result.reset_at) - Date.now()) / 1000))
      log.warn('rate_limit.tripped', { rule: rule.name, scope: c.kind, id: c.kind === 'user' ? c.id : undefined, ip: c.kind === 'ip' ? c.id : undefined, retry_after: retryAfter })
      return NextResponse.json(
        { error: 'Too many requests. Please try again shortly.', code: 'RATE_LIMITED', retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      )
    }
  }
  return null
}
