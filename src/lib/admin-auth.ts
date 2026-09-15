import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'
import { RULES, enforceRateLimit } from '@/lib/rate-limit'

export type AdminAuth =
  | { ok: true; user: User; adminClient: SupabaseClient }
  | { ok: false; error: NextResponse }

/**
 * Verifies the current user is an admin. Call at the top of every
 * /api/admin/* handler:
 *
 *   const auth = await requireAdmin()
 *   if (!auth.ok) return auth.error
 *
 * 401 without a session, 403 without the admin flag (which only the
 * service role can set since migration 006), 429 over the admin rate limit.
 * There is no development bypass: an admin session is an admin session.
 */
export async function requireAdmin(): Promise<AdminAuth> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return { ok: false, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }

    const adminClient = createAdminClient()
    const { data: profile } = await adminClient
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.is_admin) {
      return { ok: false, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    }

    const limited = await enforceRateLimit(RULES.admin, { userId: user.id })
    if (limited) return { ok: false, error: limited }

    return { ok: true, user, adminClient }
  } catch (err) {
    log.error('admin.auth_check_failed', err, { path: 'admin_review' })
    return { ok: false, error: NextResponse.json({ error: 'Something went wrong. Please try again.', code: 'INTERNAL' }, { status: 500 }) }
  }
}
