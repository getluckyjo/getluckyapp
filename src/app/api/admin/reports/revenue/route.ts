import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError } from '@/lib/api/http'
import { TIER_LABELS } from '@/lib/tiers'

interface Row { tier: string; stake_pence: number | null; potential_win_pence: number | null; status: string; course_id: string }

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { data, error } = await auth.adminClient.from('bets').select('tier, stake_pence, potential_win_pence, status, course_id')
    if (error) throw error
    const bets = (data ?? []) as Row[]

    const courseIds = [...new Set(bets.map(b => b.course_id).filter(Boolean))]
    const { data: courses } = courseIds.length
      ? await auth.adminClient.from('courses').select('id, name').in('id', courseIds)
      : { data: [] as { id: string; name: string }[] }
    const courseName = new Map(((courses ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))

    const totalRevenue = bets.reduce((s, b) => s + (b.stake_pence ?? 0), 0)
    const totalPayouts = bets.filter(b => b.status === 'paid').reduce((s, b) => s + (b.potential_win_pence ?? 0), 0)

    const byTier = Object.entries(TIER_LABELS).map(([tier, label]) => {
      const tierBets = bets.filter(b => b.tier === tier)
      return {
        tier,
        label,
        count: tierBets.length,
        revenue: tierBets.reduce((s, b) => s + (b.stake_pence ?? 0), 0),
        payouts: tierBets.filter(b => b.status === 'paid').reduce((s, b) => s + (b.potential_win_pence ?? 0), 0),
      }
    })

    const courseMap = new Map<string, { name: string; revenue: number; count: number }>()
    for (const b of bets) {
      const name = courseName.get(b.course_id) ?? 'Unknown'
      const existing = courseMap.get(name) ?? { name, revenue: 0, count: 0 }
      existing.revenue += b.stake_pence ?? 0
      existing.count += 1
      courseMap.set(name, existing)
    }
    const byCourse = [...courseMap.values()].sort((a, b) => b.revenue - a.revenue)

    return NextResponse.json({
      totalRevenue,
      totalPayouts,
      netProfit: totalRevenue - totalPayouts,
      margin: totalRevenue > 0 ? ((totalRevenue - totalPayouts) / totalRevenue * 100).toFixed(1) : '0',
      byTier,
      byCourse,
      totalBets: bets.length,
    })
  } catch (err) {
    return apiError('admin.reports.revenue_failed', err, { path: 'admin_review' })
  }
}
