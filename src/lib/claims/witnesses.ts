/**
 * The people named on a claim (docs/stage-4-proposal.md §1.2): playing
 * partners who saw the shot, and the club official who signed the
 * certificate. Batch 9 records them; Batch 11 asks them to confirm.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, WitnessRole } from '@/types/database'

export const MAX_WITNESSES = 4

export const WitnessSchema = z.object({
  role: z.enum(['witness', 'club_official']),
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().max(200).pipe(z.email()),
})

export const WitnessesSchema = z.array(WitnessSchema).max(MAX_WITNESSES)

export type WitnessInput = z.infer<typeof WitnessSchema>

export interface WitnessRow {
  id: string
  role: WitnessRole
  name: string
  email: string
  created_at: string
}

/** At least one playing partner must be named; a club official alone is not a witness to the shot. */
export function hasPlayingPartner(list: { role: WitnessRole }[]): boolean {
  return list.some(w => w.role === 'witness')
}

export async function witnessesForBet(admin: SupabaseClient<Database>, betId: string): Promise<WitnessRow[]> {
  const { data, error } = await admin
    .from('claim_witnesses')
    .select('id, role, name, email, created_at')
    .eq('bet_id', betId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Replace the set for an open claim. Duplicate emails collapse to the first. */
export async function replaceWitnesses(admin: SupabaseClient<Database>, betId: string, verificationId: string, list: WitnessInput[]): Promise<void> {
  const seen = new Set<string>()
  const rows = list
    .filter(w => (seen.has(w.email) ? false : (seen.add(w.email), true)))
    .map(w => ({ bet_id: betId, verification_id: verificationId, role: w.role, name: w.name, email: w.email }))
  const { error: delErr } = await admin.from('claim_witnesses').delete().eq('bet_id', betId)
  if (delErr) throw delErr
  if (rows.length === 0) return
  const { error } = await admin.from('claim_witnesses').insert(rows)
  if (error) throw error
}
