/**
 * Account deletion (AUDIT.md B.10, docs/batch-8-popia.md).
 *
 * What goes: the auth user, and with it (database cascade) the profile,
 * bets and verifications; every object under the golfer's folder in both
 * storage buckets.
 *
 * What stays: payfast_payments rows with user_id nulled (a financial ledger
 * keeps the amounts, not the person), and claim_events (append-only by
 * design; it holds bet and verification rows, not the profile).
 *
 * What blocks it: a suspended account (a fraud review must not be ended by
 * deleting the evidence), and a claim that is under review, approved or
 * paid (the insurer's record). Those are closed by support, by hand.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { log } from '@/lib/observability/log'
import { USER_BUCKETS, listObjectsUnder, removeObjects } from '@/lib/storage/objects'
import { hashIdentifier } from '@/lib/risk/hash'
import { CLAIMED_BET_STATUSES, WON_BET_STATUSES } from '@/lib/claims/state-machine'

export type DeletionBlock = 'ACCOUNT_SUSPENDED' | 'CLAIM_OPEN'

export interface DeletionStatus {
  canDelete: boolean
  reason: DeletionBlock | null
  /** Bets still inside their play window; deleting forfeits them. */
  activeBets: number
  bets: number
  /** Bets that reached a claim, for the deleted-accounts record. */
  claims: number
  email: string | null
}

/** A claim in one of these states is evidence that must outlive the account. */
const BLOCKING_VERIFICATION_STATUSES: readonly string[] = ['documents_received', 'under_review', 'approved']

type Admin = SupabaseClient<Database>

/**
 * Fails closed: a guard read that errors is thrown, never treated as "no
 * suspension" or "no bets". Deleting on a blind read could destroy the
 * evidence the guard exists to keep (audit S9, 11 October 2026).
 */
export async function deletionStatus(admin: Admin, userId: string): Promise<DeletionStatus> {
  const [profileRes, betsRes] = await Promise.all([
    admin.from('profiles').select('suspended_at, email').eq('id', userId).maybeSingle(),
    admin.from('bets').select('id, status').eq('user_id', userId),
  ])
  if (profileRes.error) throw new Error(`deletion guard: profile read failed: ${profileRes.error.message}`)
  if (betsRes.error) throw new Error(`deletion guard: bets read failed: ${betsRes.error.message}`)
  const profile = profileRes.data
  const list = betsRes.data ?? []
  const base = {
    activeBets: list.filter(b => b.status === 'active').length,
    bets: list.length,
    claims: list.filter(b => CLAIMED_BET_STATUSES.includes(b.status)).length,
    email: profile?.email ?? null,
  }

  if (profile?.suspended_at) return { canDelete: false, reason: 'ACCOUNT_SUSPENDED', ...base }
  if (list.some(b => WON_BET_STATUSES.includes(b.status))) return { canDelete: false, reason: 'CLAIM_OPEN', ...base }

  const claimed = list.filter(b => b.status === 'claimed').map(b => b.id)
  if (claimed.length > 0) {
    const { data: verifications, error: verErr } = await admin.from('verifications').select('status').in('bet_id', claimed)
    if (verErr) throw new Error(`deletion guard: verifications read failed: ${verErr.message}`)
    if ((verifications ?? []).some(v => BLOCKING_VERIFICATION_STATUSES.includes(v.status))) {
      return { canDelete: false, reason: 'CLAIM_OPEN', ...base }
    }
  }
  return { canDelete: true, reason: null, ...base }
}

export interface DeletionResult { objectsRemoved: number; bets: number }

export type DeletionOutcome =
  | { ok: true; result: DeletionResult }
  | { ok: false; reason: DeletionBlock; objectsRemoved: number }

/** A failure part-way, carrying how far it got so the golfer is told the truth. */
export class DeletionFailed extends Error {
  constructor(message: string, public readonly stage: 'storage' | 'auth', public readonly objectsRemoved: number, cause?: unknown) {
    super(message, { cause })
    this.name = 'DeletionFailed'
  }
}

/**
 * Storage first, then the auth user. If storage fails the account is still
 * there and the golfer can try again; if the auth delete fails after storage
 * succeeded, the account is there without footage, which only matters for a
 * claim, and an account with an open claim never gets this far. The guard
 * runs again right before the auth delete, so a claim opened between the
 * first check and here still stops the account going.
 */
export async function deleteAccount(admin: Admin, userId: string): Promise<DeletionOutcome> {
  const status = await deletionStatus(admin, userId)
  if (status.reason) return { ok: false, reason: status.reason, objectsRemoved: 0 }

  let objectsRemoved = 0
  for (const bucket of USER_BUCKETS) {
    try {
      const paths = await listObjectsUnder(admin, bucket, userId)
      await removeObjects(admin, bucket, paths)
      objectsRemoved += paths.length
    } catch (err) {
      throw new DeletionFailed(`storage: ${err instanceof Error ? err.message : String(err)}`, 'storage', objectsRemoved, err)
    }
  }

  const again = await deletionStatus(admin, userId)
  if (again.reason) {
    log.warn('account.delete_blocked_late', { user_id: userId, reason: again.reason, objects_removed: objectsRemoved })
    return { ok: false, reason: again.reason, objectsRemoved }
  }

  // Remember that this email left, and with what history, so a returning
  // deleter is visible to the deleted_and_back risk rule. Hashed; no name, no id.
  const emailHash = hashIdentifier('email', status.email)
  if (emailHash) {
    const { error: memErr } = await admin.from('deleted_accounts').insert({ email_hash: emailHash, bets: status.bets, claims: status.claims })
    if (memErr) log.error('account.delete_memory_failed', memErr, { user_id: userId })
  }

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) throw new DeletionFailed(`auth delete: ${error.message}`, 'auth', objectsRemoved, error)

  const result = { objectsRemoved, bets: status.bets }
  log.info('account.deleted', { user_id: userId, objects_removed: objectsRemoved, bets: status.bets, active_bets_forfeited: status.activeBets })
  return { ok: true, result }
}
