import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError } from '@/lib/api/http'
import { BET_SELECT, adminTotals, betsForVerifications, namesForBets, toAdminBetRecord, toQueueItem, type BetRowLike, type VerificationRowLike } from '@/lib/admin/data'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const admin = auth.adminClient

  try {
    const [totals, recentBetsRes, recentVerifsRes, profileRes] = await Promise.all([
      adminTotals(admin),
      admin.from('bets').select(BET_SELECT).order('created_at', { ascending: false }).limit(5),
      admin.from('verifications').select('*').in('status', ['pending', 'documents_received', 'under_review']).order('created_at', { ascending: true }).limit(5),
      admin.from('profiles').select('name').eq('id', auth.user.id).maybeSingle(),
    ])
    if (recentBetsRes.error) throw recentBetsRes.error
    if (recentVerifsRes.error) throw recentVerifsRes.error

    const recentBets = (recentBetsRes.data ?? []) as BetRowLike[]
    const recentVerifs = (recentVerifsRes.data ?? []) as VerificationRowLike[]
    const verifBets = await betsForVerifications(admin, recentVerifs)
    const names = await namesForBets(admin, [...recentBets, ...verifBets.values()])

    return NextResponse.json({
      totalRevenue: totals.total_revenue_cents,
      activeBets: totals.active_bets,
      pendingClaims: totals.pending_claims,
      totalPayouts: totals.total_payout_cents,
      totalUsers: totals.total_users,
      recentBets: recentBets.map(b => toAdminBetRecord(b, names)),
      recentVerifications: recentVerifs.map(v => toQueueItem(v, verifBets.get(v.bet_id), names)),
      adminName: profileRes.data?.name || 'Admin',
      adminEmail: auth.user.email ?? '',
    })
  } catch (err) {
    return apiError('admin.stats_failed', err, { path: 'admin_review' })
  }
}
