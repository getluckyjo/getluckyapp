import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseQuery, pagination } from '@/lib/api/http'
import { betsForVerifications, namesForBets, toQueueItem, type VerificationRowLike } from '@/lib/admin/data'
import { VERIFICATION_STATUSES } from '@/lib/claims/state-machine'
import { BET_TIERS } from '@/lib/tiers'
import type { VerificationQueueItem, PaginatedResponse } from '@/types/admin'

const Query = pagination.extend({
  status: z.enum(VERIFICATION_STATUSES).optional(),
  tier: z.enum(BET_TIERS.map(t => t.tier) as [string, ...string[]]).optional(),
  sort: z.enum(['oldest', 'newest', 'highest']).default('oldest'),
})

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const q = parseQuery(request.url, Query)
  if (!q.ok) return q.response
  const { status, tier, sort, page, limit } = q.data

  try {
    let query = auth.adminClient.from('verifications').select('*', { count: 'exact' })
    if (status) query = query.eq('status', status)
    query = query.order('created_at', { ascending: sort !== 'newest' })
    const offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)

    const { data, count, error } = await query
    if (error) throw error
    const rows = (data ?? []) as VerificationRowLike[]

    const bets = await betsForVerifications(auth.adminClient, rows)
    const names = await namesForBets(auth.adminClient, [...bets.values()])
    let items: VerificationQueueItem[] = rows.map(v => toQueueItem(v, bets.get(v.bet_id), names))

    if (sort === 'highest') items = [...items].sort((a, b) => b.potentialWinCents - a.potentialWinCents)

    // Tier is a bet column; filtered on the page (Batch 6 moves it into SQL).
    if (tier) {
      items = items.filter(i => i.tier === tier)
      return NextResponse.json({ data: items, total: items.length, page, limit, totalPages: Math.ceil(items.length / limit) })
    }

    const total = count ?? items.length
    const resp: PaginatedResponse<VerificationQueueItem> = { data: items, total, page, limit, totalPages: Math.ceil(total / limit) }
    return NextResponse.json(resp)
  } catch (err) {
    return apiError('admin.verifications.list_failed', err, { path: 'admin_review' })
  }
}
