/**
 * GET /api/admin/reports/payouts?kind=owed|paid&page=&limit=
 * Returns: { kind, data: PayoutRecord[], total, page, limit, totalPages }
 *
 * Prizes, split the way the admin acts on them:
 *   owed  verified and not yet paid, the longest-waiting first. Each row
 *         links to its bet, where the payout is recorded.
 *   paid  recorded as paid, the latest first, with the payout's date and
 *         its bank or PayFast reference.
 *
 * The order is the bet's last change (bets.updated_at, migration 007): for
 * a verified bet that is its verification, for a paid one its payout, as
 * nothing changes either afterwards. The dates shown come from the claim
 * (verifications.verified_at and payout_initiated_at) where it has them.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseQuery, pagination } from '@/lib/api/http'
import { BET_SELECT, namesForBets, toAdminBetRecord, type BetRowLike } from '@/lib/admin/data'

const Query = pagination.extend({ kind: z.enum(['owed', 'paid']).default('owed') })

type Row = BetRowLike & { updated_at?: string | null }
interface ClaimDates { bet_id: string; verified_at: string | null; payout_initiated_at: string | null }

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const q = parseQuery(request.url, Query)
  if (!q.ok) return q.response
  const { page, limit, kind } = q.data
  const admin = auth.adminClient

  try {
    const { data, count, error } = await admin
      .from('bets')
      .select(`${BET_SELECT}, updated_at`, { count: 'exact' })
      .eq('status', kind === 'owed' ? 'verified' : 'paid')
      .order('updated_at', { ascending: kind === 'owed', nullsFirst: false })
      .order('created_at', { ascending: kind === 'owed' })
      .range((page - 1) * limit, page * limit - 1)
    if (error) throw error

    const bets = (data ?? []) as Row[]
    const [names, claims] = await Promise.all([
      namesForBets(admin, bets),
      bets.length
        ? admin.from('verifications').select('bet_id, verified_at, payout_initiated_at').in('bet_id', bets.map(b => b.id))
        : Promise.resolve({ data: [] as ClaimDates[], error: null }),
    ])
    if (claims.error) throw claims.error
    const claimByBet = new Map(((claims.data ?? []) as ClaimDates[]).map(c => [c.bet_id, c]))

    const records = bets.map(b => {
      const claim = claimByBet.get(b.id)
      return {
        ...toAdminBetRecord(b, names),
        verifiedAt: claim?.verified_at ?? null,
        // The payout's own time; the bet's last change when that was not recorded.
        paidAt: kind === 'paid' ? claim?.payout_initiated_at ?? b.updated_at ?? null : null,
        payoutReference: b.payout_reference ?? null,
      }
    })
    const total = count ?? records.length
    return NextResponse.json({ kind, data: records, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) })
  } catch (err) {
    return apiError('admin.reports.payouts_failed', err, { path: 'admin_review' })
  }
}
