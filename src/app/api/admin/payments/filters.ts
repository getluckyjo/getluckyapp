/**
 * The payments list's filters, shared with the CSV export so the file an
 * admin downloads holds the payments the page shows.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { searchTerm } from '@/lib/api/http'
import { orSearchTerm } from '@/lib/admin/data'

export const paymentFilters = {
  status: z.enum(['complete', 'amount_mismatch', 'pending', 'failed']).optional(),
  search: searchTerm.optional(),
}

/**
 * Where a payments list reads from. "Paid, but no bet" is migration 032's
 * view (complete or amount_mismatch, no bet_id, and no bet carrying the
 * reference), because the ledger's bet_id link is best-effort: filtering on
 * it counted payments that did have a bet, and left out amount mismatches.
 */
export function paymentsSource(unmatched: boolean | undefined): 'admin_unmatched_payments' | 'payfast_payments' {
  return unmatched ? 'admin_unmatched_payments' : 'payfast_payments'
}

/** A search as `.or()` conditions: either reference, or a golfer found by name or email. */
export async function paymentSearchConditions(admin: SupabaseClient, search: string): Promise<string[]> {
  const s = orSearchTerm(search)
  const { data: users, error } = await admin.from('profiles').select('id').or(`name.ilike.*${s}*,email.ilike.*${s}*`).limit(100)
  if (error) throw error
  const conds = [`m_payment_id.ilike.*${s}*`, `pf_payment_id.ilike.*${s}*`]
  const userIds = ((users ?? []) as { id: string }[]).map(u => u.id)
  if (userIds.length) conds.push(`user_id.in.(${userIds.join(',')})`)
  return conds
}
