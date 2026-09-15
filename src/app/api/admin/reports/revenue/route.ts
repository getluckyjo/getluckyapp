import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError } from '@/lib/api/http'
import { adminTotals } from '@/lib/admin/data'
import { TIER_LABELS } from '@/lib/tiers'

interface TierRow { tier: string; bet_count: number; revenue_cents: number; payout_cents: number }
interface CourseRow { course_id: string; course_name: string; bet_count: number; revenue_cents: number }

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const admin = auth.adminClient

  try {
    const [totals, tierRes, courseRes] = await Promise.all([
      adminTotals(admin),
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

    const totalRevenue = totals.total_revenue_cents
    const totalPayouts = totals.total_payout_cents
    return NextResponse.json({
      totalRevenue,
      totalPayouts,
      netProfit: totalRevenue - totalPayouts,
      margin: totalRevenue > 0 ? ((totalRevenue - totalPayouts) / totalRevenue * 100).toFixed(1) : '0',
      byTier,
      byCourse,
      totalBets: totals.total_bets,
    })
  } catch (err) {
    return apiError('admin.reports.revenue_failed', err, { path: 'admin_review' })
  }
}
