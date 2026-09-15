import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Supabase admin client — bypasses Row Level Security.
 * Use only in server-side API routes that run without a user session
 * (e.g. PayFast ITN webhook, cron jobs).
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in your environment variables.
 */
export function createAdminClient() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()

  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. Required for server-to-server operations.')
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
