import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseQuery, pagination, boolString, searchTerm } from '@/lib/api/http'
import { orSearchTerm } from '@/lib/admin/data'
import type { AdminUserRecord, PaginatedResponse } from '@/types/admin'

const Query = pagination.extend({
  search: searchTerm.optional(),
  suspended: boolString.optional(),
})

interface ProfileRow { id: string; name: string | null; email: string | null; handicap: number | null; total_attempts: number | null; payment_method: string | null; is_admin: boolean | null; suspended_at: string | null; suspended_reason: string | null; created_at: string }
interface BetTotals { user_id: string; stake_pence: number | null; potential_win_pence: number | null; status: string }

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const q = parseQuery(request.url, Query)
  if (!q.ok) return q.response
  const { search, suspended, page, limit } = q.data

  try {
    let query = auth.adminClient.from('profiles').select('id, name, email, handicap, total_attempts, payment_method, is_admin, suspended_at, suspended_reason, created_at', { count: 'exact' })
    if (suspended === true) query = query.not('suspended_at', 'is', null)
    if (suspended === false) query = query.is('suspended_at', null)
    if (search) {
      // In the query, so the count and the pages are right.
      const s = orSearchTerm(search)
      query = query.or(`name.ilike.*${s}*,email.ilike.*${s}*`)
    }
    query = query.order('created_at', { ascending: false })
    const offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)

    const { data, count, error } = await query
    if (error) throw error
    const profiles = (data ?? []) as ProfileRow[]

    // One query for the page's bet totals instead of one per user.
    const ids = profiles.map(p => p.id)
    const { data: betsRaw } = ids.length
      ? await auth.adminClient.from('bets').select('user_id, stake_pence, potential_win_pence, status').in('user_id', ids)
      : { data: [] as BetTotals[] }
    const totals = new Map<string, { staked: number; won: number }>()
    for (const b of (betsRaw ?? []) as BetTotals[]) {
      const t = totals.get(b.user_id) ?? { staked: 0, won: 0 }
      t.staked += b.stake_pence ?? 0
      if (b.status === 'paid' || b.status === 'verified') t.won += b.potential_win_pence ?? 0
      totals.set(b.user_id, t)
    }

    const records: AdminUserRecord[] = profiles.map(p => ({
      id: p.id,
      name: p.name,
      email: p.email ?? '',
      handicap: p.handicap,
      totalAttempts: p.total_attempts ?? 0,
      totalStaked: totals.get(p.id)?.staked ?? 0,
      totalWon: totals.get(p.id)?.won ?? 0,
      paymentMethod: p.payment_method,
      isAdmin: p.is_admin ?? false,
      suspendedAt: p.suspended_at,
      suspendedReason: p.suspended_reason,
      createdAt: p.created_at,
    }))

    const total = count ?? records.length
    const resp: PaginatedResponse<AdminUserRecord> = { data: records, total, page, limit, totalPages: Math.ceil(total / limit) }
    return NextResponse.json(resp)
  } catch (err) {
    return apiError('admin.users.list_failed', err, { path: 'admin_review' })
  }
}
