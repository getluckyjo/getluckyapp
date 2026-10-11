import type { SupabaseClient } from '@supabase/supabase-js'

/** A refusal from freeze_icon_event or draw_icon_event: the message is the code, the hint the sentence. */
export function rpcRefusal(err: unknown): { code: string; hint: string; detail: string | null } | null {
  const e = err as { code?: string; message?: string; hint?: string; details?: string } | null
  if (!e || e.code !== 'P0001' || !e.message || !/^[A-Z_]+$/.test(e.message)) return null
  return { code: e.message, hint: e.hint ?? e.message, detail: e.details || null }
}

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
  seed_source: string | null
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
