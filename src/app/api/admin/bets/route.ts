import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseQuery, pagination, uuid, dateLike } from '@/lib/api/http'
import { BET_SELECT, namesForBets, toAdminBetRecord, type BetRowLike } from '@/lib/admin/data'
import type { AdminBetRecord, PaginatedResponse } from '@/types/admin'
import { betFilters, betSearchConditions } from './filters'

const Query = pagination.extend({
  ...betFilters,
  courseId: uuid.optional(),
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
      // Resolved to ids first, then filtered in the query so the count and
      // the pages are right (it used to post-filter one page).
      const conds = await betSearchConditions(admin, search)
      if (!conds.length) {
        const empty: PaginatedResponse<AdminBetRecord> = { data: [], total: 0, page, limit, totalPages: 0 }
        return NextResponse.json(empty)
      }
      query = query.or(conds.join(','))
    }

    // id breaks ties, so a bet cannot appear on two pages or on none.
    query = query.order(sort, { ascending: order === 'asc' }).order('id')
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
