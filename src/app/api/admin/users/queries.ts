/**
 * What the users routes share: the list's filters (for the CSV export too,
 * so the file holds the users the page shows) and each golfer's totals over
 * every bet they have made.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { boolString, searchTerm } from '@/lib/api/http'
import { orSearchTerm } from '@/lib/admin/data'

/** The Users list's filters, under the names of its query string. */
export const userFilters = {
  search: searchTerm.optional(),
  suspended: boolString.optional(),
}
const UserFilters = z.object(userFilters)
export type UserFilters = z.infer<typeof UserFilters>

/** The filter methods a profiles query needs; every PostgREST filter builder has them. */
interface Filterable<Q> {
  not(column: string, operator: string, value: unknown): Q
  is(column: string, value: boolean | null): Q
  or(filters: string): Q
}

/** Apply the list's filters to a profiles query, in SQL so the count and the pages are right. */
export function filterUsers<Q extends Filterable<Q>>(query: Q, { search, suspended }: UserFilters): Q {
  let q = query
  if (suspended === true) q = q.not('suspended_at', 'is', null)
  if (suspended === false) q = q.is('suspended_at', null)
  if (search) {
    const s = orSearchTerm(search)
    q = q.or(`name.ilike.*${s}*,email.ilike.*${s}*`)
  }
  return q
}

export interface BetTotals { staked: number; won: number; bets: number }

/** Rows asked for per read; PostgREST may send fewer (its max-rows), which the loop allows for. */
const PAGE = 1000

/**
 * Staked and won per golfer over all their bets, so the list and the golfer's
 * page agree. The bets are read in pages ordered by id until a short page has
 * reached the exact count: a single read stops at PostgREST's 1,000-row cap
 * and the totals quietly stop counting. For a page of golfers this is one read.
 *
 * A SQL function summing per user_id would do it in one round trip for any
 * number of bets; this keeps to the tables until there is one.
 */
export async function betTotals(admin: SupabaseClient, userIds: string[]): Promise<Map<string, BetTotals>> {
  const totals = new Map<string, BetTotals>(userIds.map(id => [id, { staked: 0, won: 0, bets: 0 }]))
  if (!userIds.length) return totals
  let read = 0
  for (;;) {
    const { data, count, error } = await admin
      .from('bets')
      .select('id, user_id, stake_pence, potential_win_pence, status', { count: 'exact' })
      .in('user_id', userIds)
      .order('id', { ascending: true })
      .range(read, read + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as { user_id: string; stake_pence: number | null; potential_win_pence: number | null; status: string }[]
    for (const b of rows) {
      const t = totals.get(b.user_id)
      if (!t) continue
      t.bets += 1
      t.staked += b.stake_pence ?? 0
      if (b.status === 'paid' || b.status === 'verified') t.won += b.potential_win_pence ?? 0
    }
    read += rows.length
    if (rows.length === 0 || (rows.length < PAGE && read >= (count ?? 0))) return totals
  }
}
