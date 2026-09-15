import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseQuery, pagination, uuid, searchTerm, dateLike } from '@/lib/api/http'
import { BET_SELECT, namesForBets, orSearchTerm, toAdminBetRecord, type BetRowLike } from '@/lib/admin/data'
import { BET_STATUSES } from '@/lib/claims/state-machine'
import { BET_TIERS } from '@/lib/tiers'
import type { AdminBetRecord, PaginatedResponse } from '@/types/admin'

const Query = pagination.extend({
  status: z.enum(BET_STATUSES).optional(),
  tier: z.enum(BET_TIERS.map(t => t.tier) as [string, ...string[]]).optional(),
  courseId: uuid.optional(),
  search: searchTerm.optional(),
  dateFrom: dateLike.optional(),
  dateTo: dateLike.optional(),
  sort: z.enum(['created_at', 'stake_pence']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const q = parseQuery(request.url, Query)
  if (!q.ok) return q.response
  const { status, tier, courseId, search, dateFrom, dateTo, sort, order, page, limit } = q.data
  const admin = auth.adminClient

  try {
    let query = admin.from('bets').select(BET_SELECT, { count: 'exact' })
    if (status) query = query.eq('status', status)
    if (tier) query = query.eq('tier', tier)
    if (courseId) query = query.eq('course_id', courseId)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo)

    if (search) {
      // Resolve the search to ids first, then filter in the query so the
      // count and the pages are right (it used to post-filter one page).
      const s = orSearchTerm(search)
      const [users, courses] = await Promise.all([
        admin.from('profiles').select('id').or(`name.ilike.*${s}*,email.ilike.*${s}*`).limit(100),
        admin.from('courses').select('id').ilike('name', `%${search}%`).limit(50),
      ])
      const conds: string[] = []
      if (uuid.safeParse(search).success) conds.push(`id.eq.${search}`)
      const userIds = ((users.data ?? []) as { id: string }[]).map(u => u.id)
      const courseIds = ((courses.data ?? []) as { id: string }[]).map(c => c.id)
      if (userIds.length) conds.push(`user_id.in.(${userIds.join(',')})`)
      if (courseIds.length) conds.push(`course_id.in.(${courseIds.join(',')})`)
      if (!conds.length) {
        const empty: PaginatedResponse<AdminBetRecord> = { data: [], total: 0, page, limit, totalPages: 0 }
        return NextResponse.json(empty)
      }
      query = query.or(conds.join(','))
    }

    query = query.order(sort, { ascending: order === 'asc' })
    const offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)

    const { data, count, error } = await query
    if (error) throw error

    const rows = (data ?? []) as BetRowLike[]
    const names = await namesForBets(admin, rows)
    const records = rows.map(b => toAdminBetRecord(b, names))
    const total = count ?? records.length
    const resp: PaginatedResponse<AdminBetRecord> = { data: records, total, page, limit, totalPages: Math.ceil(total / limit) }
    return NextResponse.json(resp)
  } catch (err) {
    return apiError('admin.bets.list_failed', err, { path: 'admin_review' })
  }
}
