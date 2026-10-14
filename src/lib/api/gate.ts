/**
 * The gate every play request passes: who is asking, are they allowed to
 * ask this often, and what their profile says about them (18+, suspended).
 *
 * One round trip less on a golf course: the rate-limit counters and the
 * profile read go to the database together instead of one after the other.
 * The checks themselves stay where each route makes them, so a route can
 * still answer "already done" before "suspended" where that is the kinder
 * order.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { ClaimError } from '@/lib/claims/state-machine'
import { clientIp, enforceRateLimit, type RateRule } from '@/lib/rate-limit'

export interface GateProfile {
  ageVerifiedAt: string | null
  suspendedAt: string | null
}

export type Gate =
  | { ok: true; user: User; supabase: Awaited<ReturnType<typeof createClient>>; profile: GateProfile }
  | { ok: false; response: NextResponse }

/** Signed in and under the rule's limits, with the profile fields the route decides on. */
export async function gatePlayRequest(request: Request, rule: RateRule): Promise<Gate> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }

  const [limited, profile] = await Promise.all([
    enforceRateLimit(rule, { userId: user.id, ip: clientIp(request) }),
    readProfile(supabase, user.id),
  ])
  if (limited) return { ok: false, response: limited }
  return { ok: true, user, supabase, profile }
}

async function readProfile(supabase: SupabaseClient, userId: string): Promise<GateProfile> {
  const { data } = await supabase.from('profiles').select('age_verified_at, suspended_at').eq('id', userId).maybeSingle()
  return { ageVerifiedAt: data?.age_verified_at ?? null, suspendedAt: data?.suspended_at ?? null }
}

/** Throws ACCOUNT_SUSPENDED (403) from the profile already read. */
export function assertProfileNotSuspended(profile: GateProfile): void {
  if (profile.suspendedAt) throw new ClaimError('ACCOUNT_SUSPENDED', 'This account is suspended. Please contact support.', 403)
}

/** The 403 for a golfer who has not passed the 18+ check, or null. */
export function ageRefusal(profile: GateProfile): NextResponse | null {
  if (profile.ageVerifiedAt) return null
  return NextResponse.json({ error: 'Age verification required', code: 'AGE_NOT_VERIFIED' }, { status: 403 })
}
