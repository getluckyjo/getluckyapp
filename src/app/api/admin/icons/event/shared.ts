import type { SupabaseClient } from '@supabase/supabase-js'

export interface IconEventRow {
  id: string
  slug: string
  name: string
  first_tee_at: string | null
  winners_count: number
  frozen_at: string | null
  frozen_by: string | null
  snapshot_sha256: string | null
  snapshot_count: number | null
  winning_icon_id: string | null
  draw_seed: string | null
  draw_sha256: string | null
  drawn_at: string | null
  drawn_by: string | null
  created_at: string
  updated_at: string
}

/**
 * The event. There is one (icons-cup-sa-2026, seeded by migration 036);
 * the earliest row wins if that ever changes, so the admin routes and the
 * public route agree on which one they mean.
 */
export async function loadIconEvent(admin: SupabaseClient): Promise<IconEventRow | null> {
  const { data, error } = await admin
    .from('icon_events')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as IconEventRow | null) ?? null
}
