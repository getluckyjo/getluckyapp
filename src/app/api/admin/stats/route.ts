/**
 * GET /api/admin/stats
 *
 * The dashboard: the totals (./totals.ts; the keys from migration 032 are
 * null before it runs), the five newest bets, and the five oldest open
 * claims. Only the dashboard asks; the layout's gate and badge are
 * /api/admin/me.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError } from '@/lib/api/http'
import { BET_SELECT, betsForVerifications, namesForBets, toAdminBetRecord, toQueueItem, type BetRowLike, type VerificationRowLike } from '@/lib/admin/data'
import { readTotals } from './totals'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const admin = auth.adminClient

  try {
    const [totals, recentBetsRes, oldestClaimsRes] = await Promise.all([
      readTotals(admin),
      admin.from('bets').select(BET_SELECT).order('created_at', { ascending: false }).limit(5),
      admin.from('verifications').select('*').in('status', ['pending', 'documents_received', 'under_review']).order('created_at', { ascending: true }).limit(5),
    ])
    if (recentBetsRes.error) throw recentBetsRes.error
    if (oldestClaimsRes.error) throw oldestClaimsRes.error

    const recentBets = (recentBetsRes.data ?? []) as BetRowLike[]
    const oldestClaims = (oldestClaimsRes.data ?? []) as VerificationRowLike[]
    const claimBets = await betsForVerifications(admin, oldestClaims)
    const names = await namesForBets(admin, [...recentBets, ...claimBets.values()])

    return NextResponse.json({
      totalRevenue: totals.stakesCents,
      totalPayouts: totals.prizesPaidCents,
      totalBets: totals.totalBets,
      activeBets: totals.activeBets,
      pendingClaims: totals.pendingClaims,
      totalUsers: totals.totalUsers,
      expiredBets: totals.expiredBets,
      claimsToReview: totals.claimsToReview,
      claimsWaiting: totals.claimsWaiting,
      prizesOwed: totals.prizesOwedCents,
      recentBets: recentBets.map(b => toAdminBetRecord(b, names)),
      // Oldest first: the claims that have waited longest.
      recentVerifications: oldestClaims.map(v => toQueueItem(v, claimBets.get(v.bet_id), names)),
    })
  } catch (err) {
    return apiError('admin.stats_failed', err, { path: 'admin_review' })
  }
}
