import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'
import { RULES, enforceRateLimit } from '@/lib/rate-limit'

const MOCK_ADMIN = {
  user: { id: 'mock-admin-user', email: 'admin@getlucky.golf' },
  adminClient: null as ReturnType<typeof createAdminClient> | null,
  isMock: true,
  error: null,
}

/**
 * Verifies the current user is an admin.
 * Call at the top of every /api/admin/* route handler.
 *
 * In development, falls back to mock mode if no session exists.
 * In production, returns 401/403 for unauthenticated/non-admin users.
 */
export async function requireAdmin() {
  // Check if Supabase is configured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!supabaseUrl || supabaseUrl.includes('YOUR_PROJECT_REF')) {
    return MOCK_ADMIN
  }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      // Dev bypass removed for security — require explicit ENABLE_MOCK_ADMIN=true
      if (process.env.NODE_ENV === 'development' && process.env.ENABLE_MOCK_ADMIN === 'true') {
        return MOCK_ADMIN
      }
      return {
        user: null,
        adminClient: null,
        isMock: false,
        error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      }
    }

    const adminClient = createAdminClient()
    const { data: profile } = await adminClient
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      return {
        user: null,
        adminClient: null,
        isMock: false,
        error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      }
    }

    const limited = await enforceRateLimit(RULES.admin, { userId: user.id })
    if (limited) {
      return { user: null, adminClient: null, isMock: false, error: limited }
    }

    return {
      user,
      adminClient,
      isMock: false,
      error: null,
    }
  } catch (err) {
    // Dev bypass removed for security — require explicit ENABLE_MOCK_ADMIN=true
    if (process.env.NODE_ENV === 'development' && process.env.ENABLE_MOCK_ADMIN === 'true') {
      return MOCK_ADMIN
    }
    log.error('admin.auth_check_failed', err, { path: 'admin_review' })
    return {
      user: null,
      adminClient: null,
      isMock: false,
      error: NextResponse.json({ error: 'Internal error' }, { status: 500 }),
    }
  }
}
