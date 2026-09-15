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
  source: 'claimant' | 'course'
  requested_at: string | null
  request_count: number
  responded_at: string | null
  response: 'confirmed' | 'denied' | null
  response_note: string | null
  token_expires_at: string | null
  created_at: string
}

/** At least one playing partner must be named; a club official alone is not a witness to the shot. */
export function hasPlayingPartner(list: { role: WitnessRole }[]): boolean {
  return list.some(w => w.role === 'witness')
}

const WITNESS_COLUMNS = 'id, role, name, email, source, requested_at, request_count, responded_at, response, response_note, token_expires_at, created_at'

export async function witnessesForBet(admin: SupabaseClient<Database>, betId: string): Promise<WitnessRow[]> {
  const { data, error } = await admin
    .from('claim_witnesses')
    .select(WITNESS_COLUMNS)
    .eq('bet_id', betId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as WitnessRow[]
}

/**
 * Bring the claimant-named set in line with the submission. People still on
 * the list keep their row (and with it any request already sent or answer
 * already given); people dropped are removed; new people are added. Rows
 * the course's contact list added are never touched here.
 */
export async function replaceWitnesses(admin: SupabaseClient<Database>, betId: string, verificationId: string, list: WitnessInput[]): Promise<void> {
  const seen = new Set<string>()
  const wanted = list.filter(w => (seen.has(w.email) ? false : (seen.add(w.email), true)))

  const { data: current, error: readErr } = await admin.from('claim_witnesses').select('id, email, name, role').eq('bet_id', betId).eq('source', 'claimant')
  if (readErr) throw readErr
  const byEmail = new Map((current ?? []).map(w => [w.email.toLowerCase(), w]))

  const dropped = (current ?? []).filter(w => !seen.has(w.email.toLowerCase())).map(w => w.id)
  if (dropped.length > 0) {
    const { error } = await admin.from('claim_witnesses').delete().in('id', dropped)
    if (error) throw error
  }
  for (const w of wanted) {
    const existing = byEmail.get(w.email)
    if (existing) {
      if (existing.name !== w.name || existing.role !== w.role) {
        const { error } = await admin.from('claim_witnesses').update({ name: w.name, role: w.role }).eq('id', existing.id)
        if (error) throw error
      }
    } else {
      const { error } = await admin.from('claim_witnesses').insert({ bet_id: betId, verification_id: verificationId, role: w.role, name: w.name, email: w.email, source: 'claimant' })
      if (error) throw error
    }
  }
}
