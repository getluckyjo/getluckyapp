/**
 * Claims that cannot go anywhere, closed without a reviewer.
 *
 * A claim is approved only after the reviewer has watched the footage to
 * the end (the first line of the checklist). A claim whose bet never had
 * footage sealed cannot pass that line, and once the play window has
 * closed no footage can arrive. Such a claim used to sit in the queue
 * until someone opened it, read it, and rejected it by hand. Now the
 * nightly cron does that after a week's grace, with a note that says
 * exactly why, and the reviewer's time goes to claims with a ball in a
 * hole on film.
 *
 * Only claims nobody has picked up: `under_review` means a person is on
 * it. The bet stays `claimed`, as it does after any rejection.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { isExpired } from '@/lib/claims/state-machine'
import { log } from '@/lib/observability/log'

export const NO_FOOTAGE_GRACE_DAYS = 7

export const NO_FOOTAGE_NOTE = 'Closed automatically: no footage was sealed for this bet, the play window has passed, and a week went by. There is nothing to review.'

export interface TriageResult {
  /** Claims closed for want of footage. */
  noFootage: number
  errors: number
}

type Admin = SupabaseClient<Database>

export async function closeClaimsWithoutFootage(admin: Admin, opts: { now?: Date; limit?: number } = {}): Promise<TriageResult> {
  const now = opts.now ?? new Date()
  const limit = opts.limit ?? 100
  const cutoff = new Date(now.getTime() - NO_FOOTAGE_GRACE_DAYS * 86_400_000).toISOString()
  const result: TriageResult = { noFootage: 0, errors: 0 }

  const { data: claims, error } = await admin
    .from('verifications')
    .select('id, bet_id, status')
    .in('status', ['pending', 'documents_received'])
    .lte('created_at', cutoff)
    .limit(limit)
  if (error) throw error
  if (!claims?.length) return result

  const { data: bets, error: betErr } = await admin
    .from('bets')
    .select('id, status, video_sha256, expires_at')
    .in('id', claims.map(c => c.bet_id))
  if (betErr) throw betErr
  const betById = new Map((bets ?? []).map(b => [b.id, b]))

  for (const claim of claims) {
    const bet = betById.get(claim.bet_id)
    if (!bet || bet.status !== 'claimed' || bet.video_sha256 || !isExpired(bet, now.getTime())) continue
    try {
      const { data, error: updErr } = await admin
        .from('verifications')
        .update({ status: 'rejected', reviewer_notes: NO_FOOTAGE_NOTE, review_checklist: { auto: 'no_footage', closed_at: now.toISOString() } })
        .eq('id', claim.id)
        .eq('status', claim.status)
        .select('id')
      if (updErr) throw updErr
      if (!data?.length) continue // a reviewer got there first
      result.noFootage++
      log.info('claim.closed_no_footage', { verification_id: claim.id, bet_id: claim.bet_id })
    } catch (err) {
      result.errors++
      log.error('claim.close_no_footage_failed', err, { path: 'claim', verification_id: claim.id })
    }
  }
  return result
}
