/**
 * Retention: footage and claim documents are deleted once they have no
 * purpose (AUDIT.md B.10, docs/batch-8-popia.md).
 *
 *   miss      footage removed RETENTION_DAYS after the miss was declared
 *   rejected  documents and footage removed RETENTION_DAYS after the review
 *   verified / paid   never touched here: the insurer's record of a payout
 *
 * Run nightly by /api/cron/retention. Each row is handled on its own so one
 * bad object cannot stall the sweep; failures are counted, logged, and tried
 * again the next night because the purge marker is only set on success.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { log } from '@/lib/observability/log'
import { removeObjects } from '@/lib/storage/objects'

export const DEFAULT_RETENTION_DAYS = 90
const MIN_RETENTION_DAYS = 7

/** RETENTION_DAYS from the environment, default 90, never below 7. */
export function retentionDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.RETENTION_DAYS)
  return Number.isInteger(n) && n >= MIN_RETENTION_DAYS ? n : DEFAULT_RETENTION_DAYS
}

export interface RetentionResult {
  cutoff: string
  days: number
  /** Misses whose footage (if any) was removed and marked. */
  misses: number
  /** Rejected claims whose documents and footage were removed and marked. */
  rejectedClaims: number
  objectsRemoved: number
  errors: number
}

export interface RetentionOptions {
  now?: Date
  days?: number
  /** Rows per scan per run. Anything left is picked up next night. */
  limit?: number
}

type Admin = SupabaseClient<Database>

export async function runRetention(admin: Admin, opts: RetentionOptions = {}): Promise<RetentionResult> {
  const now = opts.now ?? new Date()
  const days = opts.days ?? retentionDays()
  const limit = opts.limit ?? 200
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString()
  const result: RetentionResult = { cutoff, days, misses: 0, rejectedClaims: 0, objectsRemoved: 0, errors: 0 }

  // 1. Misses past the window.
  const { data: misses, error: missErr } = await admin
    .from('bets')
    .select('id, video_url')
    .eq('status', 'miss')
    .is('footage_purged_at', null)
    .lte('declared_at', cutoff)
    .limit(limit)
  if (missErr) throw missErr

  for (const bet of misses ?? []) {
    try {
      result.objectsRemoved += await purgeFootage(admin, bet, now)
      result.misses++
    } catch (err) {
      result.errors++
      log.error('retention.miss_failed', err, { bet_id: bet.id })
    }
  }

  // 2. Rejected claims past the window: documents, then the bet's footage.
  const { data: rejected, error: rejErr } = await admin
    .from('verifications')
    .select('id, bet_id, certificate_path, affidavit_path')
    .eq('status', 'rejected')
    .is('documents_purged_at', null)
    .lte('updated_at', cutoff)
    .limit(limit)
  if (rejErr) throw rejErr

  for (const v of rejected ?? []) {
    try {
      const docs = [v.certificate_path, v.affidavit_path].filter((p): p is string => typeof p === 'string' && p.length > 0)
      await removeObjects(admin, 'verification-docs', docs)
      const { error } = await admin
        .from('verifications')
        .update({ certificate_path: null, affidavit_path: null, documents_purged_at: now.toISOString() })
        .eq('id', v.id)
      if (error) throw error
      result.objectsRemoved += docs.length

      // The people named on a refused claim have no further part to play.
      const { error: wErr } = await admin.from('claim_witnesses').delete().eq('bet_id', v.bet_id)
      if (wErr) throw wErr

      const { data: bet } = await admin
        .from('bets')
        .select('id, video_url, footage_purged_at')
        .eq('id', v.bet_id)
        .maybeSingle()
      if (bet && !bet.footage_purged_at) result.objectsRemoved += await purgeFootage(admin, bet, now)
      result.rejectedClaims++
    } catch (err) {
      result.errors++
      log.error('retention.rejected_failed', err, { verification_id: v.id, bet_id: v.bet_id })
    }
  }

  log.info('retention.run', { ...result })
  return result
}

/** Remove a bet's footage object (if any) and stamp the bet. Returns objects removed. */
async function purgeFootage(admin: Admin, bet: { id: string; video_url: string | null }, now: Date): Promise<number> {
  const path = bet.video_url
  if (path) await removeObjects(admin, 'shot-videos', [path])
  const { error } = await admin
    .from('bets')
    .update({ video_url: null, footage_purged_at: now.toISOString() })
    .eq('id', bet.id)
  if (error) throw error
  return path ? 1 : 0
}
