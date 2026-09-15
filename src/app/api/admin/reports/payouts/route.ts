import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseQuery, pagination } from '@/lib/api/http'
import { BET_SELECT, namesForBets, toAdminBetRecord, type BetRowLike } from '@/lib/admin/data'

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const q = parseQuery(request.url, pagination)
  if (!q.ok) return q.response
  const { page, limit } = q.data

  try {
    const { data, count, error } = await auth.adminClient
      .from('bets')
      .select(BET_SELECT, { count: 'exact' })
      .in('status', ['paid', 'verified'])
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)
    if (error) throw error

    const bets = (data ?? []) as BetRowLike[]
    const names = await namesForBets(auth.adminClient, bets)
    const records = bets.map(b => toAdminBetRecord(b, names))
    const total = count ?? records.length
    return NextResponse.json({ data: records, total, page, limit, totalPages: Math.ceil(total / limit) })
  } catch (err) {
    return apiError('admin.reports.payouts_failed', err, { path: 'admin_review' })
  }
}
