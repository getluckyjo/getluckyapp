import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseQuery, pagination } from '@/lib/api/http'
import { betsForVerifications, namesForBets, toQueueItem, type VerificationRowLike } from '@/lib/admin/data'
import { VERIFICATION_STATUSES } from '@/lib/claims/state-machine'
import { ALL_TIERS } from '@/lib/tiers'
import type { VerificationQueueItem, PaginatedResponse } from '@/types/admin'
import { OPEN_REVIEW_STATUSES, QUEUE_STAGES } from './review-types'

const Query = pagination.extend({
  status: z.enum(VERIFICATION_STATUSES).optional(),
  /** open: waiting on a reviewer. awaiting_payout: approved, prize not yet paid. */
  stage: z.enum(QUEUE_STAGES).optional(),
  tier: z.enum(ALL_TIERS.map(t => t.tier) as [string, ...string[]]).optional(),
  sort: z.enum(['oldest', 'newest', 'highest', 'risk']).default('oldest'),
})

/** Only bets in these states can have a verification at all. */
const CLAIMED_STATES = ['claimed', 'verified', 'paid']

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const q = parseQuery(request.url, Query)
  if (!q.ok) return q.response
  const { status, stage, tier, sort, page, limit } = q.data
  const admin = auth.adminClient
  const offset = (page - 1) * limit
  // The verification statuses a stage covers; awaiting_payout also needs the bet to be verified.
  const stageStatuses: string[] | null = stage === 'open' ? [...OPEN_REVIEW_STATUSES] : stage === 'awaiting_payout' ? ['approved'] : null

  try {
    let rows: VerificationRowLike[]
    let total: number

    if (tier || sort === 'highest' || sort === 'risk' || stage === 'awaiting_payout') {
      // Tier, prize, risk and payout state live on the bet. Resolve the
      // ordered set of claimed bets first (small: only bets that reached a
      // claim), then page over their verifications in that order. Count and
      // pages are exact. Awaiting payout: approved, and the bet verified, not paid.
      let bq = admin.from('bets').select('id').in('status', stage === 'awaiting_payout' ? ['verified'] : CLAIMED_STATES)
      if (tier) bq = bq.eq('tier', tier)
      bq = sort === 'highest'
        ? bq.order('potential_win_pence', { ascending: false })
        : sort === 'risk'
        ? bq.order('risk_score', { ascending: false })
        : bq.order('created_at', { ascending: sort !== 'newest' })
      const { data: betIdsRaw, error: betErr } = await bq.limit(5000)
      if (betErr) throw betErr
      const orderedIds = ((betIdsRaw ?? []) as { id: string }[]).map(b => b.id)

      let vq = admin.from('verifications').select('*')
      if (orderedIds.length) vq = vq.in('bet_id', orderedIds)
      if (status) vq = vq.eq('status', status)
      if (stageStatuses) vq = vq.in('status', stageStatuses)
      const { data: vRaw, error: vErr } = orderedIds.length ? await vq : { data: [], error: null }
      if (vErr) throw vErr
      const byBet = new Map(((vRaw ?? []) as VerificationRowLike[]).map(v => [v.bet_id, v]))
      const ordered = orderedIds.map(id => byBet.get(id)).filter((v): v is VerificationRowLike => !!v)
      total = ordered.length
      rows = ordered.slice(offset, offset + limit)
    } else {
      let query = admin.from('verifications').select('*', { count: 'exact' })
      if (status) query = query.eq('status', status)
      if (stageStatuses) query = query.in('status', stageStatuses)
      query = query.order('created_at', { ascending: sort !== 'newest' }).range(offset, offset + limit - 1)
      const { data, count, error } = await query
      if (error) throw error
      rows = (data ?? []) as VerificationRowLike[]
      total = count ?? rows.length
    }

    const bets = await betsForVerifications(admin, rows)
    const names = await namesForBets(admin, [...bets.values()])
    const items: VerificationQueueItem[] = rows.map(v => toQueueItem(v, bets.get(v.bet_id), names))

    const resp: PaginatedResponse<VerificationQueueItem> = { data: items, total, page, limit, totalPages: Math.ceil(total / limit) }
    return NextResponse.json(resp)
  } catch (err) {
    return apiError('admin.verifications.list_failed', err, { path: 'admin_review' })
  }
}
