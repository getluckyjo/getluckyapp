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

export async function deletionStatus(admin: Admin, userId: string): Promise<DeletionStatus> {
  const [{ data: profile }, { data: bets }] = await Promise.all([
    admin.from('profiles').select('suspended_at, email').eq('id', userId).maybeSingle(),
    admin.from('bets').select('id, status').eq('user_id', userId),
  ])
  const list = bets ?? []
  const base = {
    activeBets: list.filter(b => b.status === 'active').length,
    bets: list.length,
    claims: list.filter(b => b.status === 'claimed' || b.status === 'verified' || b.status === 'paid').length,
    email: profile?.email ?? null,
  }

  if (profile?.suspended_at) return { canDelete: false, reason: 'ACCOUNT_SUSPENDED', ...base }
  if (list.some(b => b.status === 'verified' || b.status === 'paid')) return { canDelete: false, reason: 'CLAIM_OPEN', ...base }

  const claimed = list.filter(b => b.status === 'claimed').map(b => b.id)
  if (claimed.length > 0) {
    const { data: verifications } = await admin.from('verifications').select('status').in('bet_id', claimed)
    if ((verifications ?? []).some(v => BLOCKING_VERIFICATION_STATUSES.includes(v.status))) {
      return { canDelete: false, reason: 'CLAIM_OPEN', ...base }
    }
  }
  return { canDelete: true, reason: null, ...base }
}

export interface DeletionResult { objectsRemoved: number; bets: number }

export type DeletionOutcome =
  | { ok: true; result: DeletionResult }
  | { ok: false; reason: DeletionBlock }

/**
 * Storage first, then the auth user. If storage fails the account is still
 * there and the golfer can try again; if the auth delete fails after storage
 * succeeded, the account is there without footage, which only matters for a
 * claim, and an account with an open claim never gets this far.
 */
export async function deleteAccount(admin: Admin, userId: string): Promise<DeletionOutcome> {
  const status = await deletionStatus(admin, userId)
  if (status.reason) return { ok: false, reason: status.reason }

  let objectsRemoved = 0
  for (const bucket of USER_BUCKETS) {
    const paths = await listObjectsUnder(admin, bucket, userId)
    await removeObjects(admin, bucket, paths)
    objectsRemoved += paths.length
  }

  // Remember that this email left, and with what history, so a returning
  // deleter is visible to the deleted_and_back risk rule. Hashed; no name, no id.
  const emailHash = hashIdentifier('email', status.email)
  if (emailHash) {
    const { error: memErr } = await admin.from('deleted_accounts').insert({ email_hash: emailHash, bets: status.bets, claims: status.claims })
    if (memErr) log.error('account.delete_memory_failed', memErr, { user_id: userId })
  }

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) throw new Error(`auth delete: ${error.message}`)

  const result = { objectsRemoved, bets: status.bets }
  log.info('account.deleted', { user_id: userId, objects_removed: objectsRemoved, bets: status.bets, active_bets_forfeited: status.activeBets })
  return { ok: true, result }
}
