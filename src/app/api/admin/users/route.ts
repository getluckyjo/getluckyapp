import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseQuery, pagination } from '@/lib/api/http'
import type { AdminUserRecord, PaginatedResponse } from '@/types/admin'
import { betTotals, filterUsers, userFilters } from './queries'

const Query = pagination.extend(userFilters)

interface ProfileRow { id: string; name: string | null; email: string | null; handicap: number | null; total_attempts: number | null; payment_method: string | null; is_admin: boolean | null; suspended_at: string | null; suspended_reason: string | null; created_at: string }

const COLUMNS = 'id, name, email, handicap, total_attempts, payment_method, is_admin, suspended_at, suspended_reason, created_at'

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const q = parseQuery(request.url, Query)
  if (!q.ok) return q.response
  const { page, limit, ...filters } = q.data

  try {
    const offset = (page - 1) * limit
    const { data, count, error } = await filterUsers(auth.adminClient.from('profiles').select(COLUMNS, { count: 'exact' }), filters)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    const profiles = (data ?? []) as unknown as ProfileRow[]

    // Totals over every bet of the page's golfers, the same figures their own page shows.
    const totals = await betTotals(auth.adminClient, profiles.map(p => p.id))

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
