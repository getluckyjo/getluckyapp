import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { apiError, parseBody } from '@/lib/api/http'

const Body = z.object({
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please enter a valid date of birth.'),
  consent: z.boolean().default(false),
})

/**
 * POST /api/profile/age-check
 * Body: { dateOfBirth: 'YYYY-MM-DD', consent: true }
 *
 * The 18+ gate. The date of birth is self-declared, but the *decision* is
 * made here, on the server, and the columns the money path trusts
 * (`age_verified_at`, `terms_accepted_at`, `date_of_birth`) are written with
 * the service role. Migration 006 makes them read-only to the browser.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const limited = await enforceRateLimit(RULES.ageCheck, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited

    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { dateOfBirth: dob, consent } = body.data

    const age = ageFromDob(dob)
    if (age === null || age < 0 || age > 120) {
      return NextResponse.json({ error: 'Please enter a valid date of birth.', code: 'INVALID_DOB' }, { status: 400 })
    }
    if (age < 18) {
      log.warn('age_check.under_18', { user_id: user.id })
      return NextResponse.json({ error: 'You must be 18 or older.', code: 'UNDER_18' }, { status: 403 })
    }
    if (!consent) {
      return NextResponse.json({ error: 'Please confirm you agree to the terms to continue.', code: 'CONSENT_REQUIRED' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const admin = createAdminClient()
    const { error } = await admin
      .from('profiles')
      .upsert({
        id: user.id,
        date_of_birth: dob,
        age_verified_at: now,
        terms_accepted_at: now,
        onboarding_done: true,
      })

    if (error) {
      log.error('age_check.write_failed', error, { path: 'auth', user_id: user.id })
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
    }

    log.info('age_check.passed', { user_id: user.id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError('age_check.unhandled', err, { path: 'auth' })
  }
}

/** Whole years between a YYYY-MM-DD date of birth and today (UTC). Null if the date is not real. */
export function ageFromDob(dob: string, today = new Date()): number | null {
  const [y, m, d] = dob.split('-').map(Number)
  const birth = new Date(Date.UTC(y, m - 1, d))
  if (birth.getUTCFullYear() !== y || birth.getUTCMonth() !== m - 1 || birth.getUTCDate() !== d) return null
  let age = today.getUTCFullYear() - y
  const monthDiff = today.getUTCMonth() - (m - 1)
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < d)) age--
  return age
}
