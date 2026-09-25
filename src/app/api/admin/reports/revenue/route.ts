/**
 * GET /api/admin/reports/revenue
 *
 * Stakes taken and prizes paid, in all and by tier and course. "Revenue" is
 * the sum of stakes (what golfers staked, not what PayFast settled), and
 * netProfit is stakes minus prizes paid: prizes owed (verified, not yet
 * paid) are reported beside it, null before migration 032.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError } from '@/lib/api/http'
import { TIER_LABELS } from '@/lib/tiers'
import { readTotals } from '../../stats/totals'

interface TierRow { tier: string; bet_count: number; revenue_cents: number; payout_cents: number }
interface CourseRow { course_id: string; course_name: string; bet_count: number; revenue_cents: number }

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const admin = auth.adminClient

  try {
    const [totals, tierRes, courseRes] = await Promise.all([
      readTotals(admin),
      admin.rpc('admin_revenue_by_tier'),
      admin.rpc('admin_revenue_by_course'),
    ])
    if (tierRes.error) throw tierRes.error
    if (courseRes.error) throw courseRes.error

    const tierRows = new Map(((tierRes.data ?? []) as TierRow[]).map(r => [r.tier, r]))
    const byTier = Object.entries(TIER_LABELS).map(([tier, label]) => {
      const r = tierRows.get(tier)
      return { tier, label, count: Number(r?.bet_count ?? 0), revenue: Number(r?.revenue_cents ?? 0), payouts: Number(r?.payout_cents ?? 0) }
    })
    const byCourse = ((courseRes.data ?? []) as CourseRow[]).map(r => ({ name: r.course_name, revenue: Number(r.revenue_cents), count: Number(r.bet_count) }))

    const totalRevenue = totals.stakesCents
    const totalPayouts = totals.prizesPaidCents
    return NextResponse.json({
      totalRevenue,
      totalPayouts,
      netProfit: totalRevenue - totalPayouts,
      margin: totalRevenue > 0 ? ((totalRevenue - totalPayouts) / totalRevenue * 100).toFixed(1) : '0',
      prizesOwed: totals.prizesOwedCents,
      byTier,
      byCourse,
      totalBets: totals.totalBets,
    })
  } catch (err) {
    return apiError('admin.reports.revenue_failed', err, { path: 'admin_review' })
  }
}
