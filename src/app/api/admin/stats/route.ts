import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError } from '@/lib/api/http'
import { BET_SELECT, betsForVerifications, namesForBets, toAdminBetRecord, toQueueItem, type BetRowLike, type VerificationRowLike } from '@/lib/admin/data'

interface Totals { stake_pence: number | null; potential_win_pence: number | null; status: string }

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const admin = auth.adminClient

  try {
    // Full-table reduce for the totals; Batch 6 replaces this with a SQL aggregate.
    const { data: totalsRaw, error: totalsErr } = await admin.from('bets').select('stake_pence, potential_win_pence, status')
    if (totalsErr) throw totalsErr
    const totals = (totalsRaw ?? []) as Totals[]
    const totalRevenue = totals.reduce((s, b) => s + (b.stake_pence ?? 0), 0)
    const activeBets = totals.filter(b => b.status === 'active').length
    const totalPayouts = totals.filter(b => b.status === 'paid').reduce((s, b) => s + (b.potential_win_pence ?? 0), 0)

    const [{ count: pendingClaims }, { count: totalUsers }, recentBetsRes, recentVerifsRes, profileRes] = await Promise.all([
      admin.from('verifications').select('id', { count: 'exact', head: true }).in('status', ['pending', 'documents_received', 'under_review']),
      admin.from('profiles').select('id', { count: 'exact', head: true }),
      admin.from('bets').select(BET_SELECT).order('created_at', { ascending: false }).limit(5),
      admin.from('verifications').select('*').in('status', ['pending', 'documents_received', 'under_review']).order('created_at', { ascending: true }).limit(5),
      admin.from('profiles').select('name').eq('id', auth.user.id).maybeSingle(),
    ])

    const recentBets = (recentBetsRes.data ?? []) as BetRowLike[]
    const recentVerifs = (recentVerifsRes.data ?? []) as VerificationRowLike[]
    const verifBets = await betsForVerifications(admin, recentVerifs)
    const names = await namesForBets(admin, [...recentBets, ...verifBets.values()])

    return NextResponse.json({
      totalRevenue,
      activeBets,
      pendingClaims: pendingClaims ?? 0,
      totalPayouts,
      totalUsers: totalUsers ?? 0,
      recentBets: recentBets.map(b => toAdminBetRecord(b, names)),
      recentVerifications: recentVerifs.map(v => toQueueItem(v, verifBets.get(v.bet_id), names)),
      adminName: profileRes.data?.name || 'Admin',
      adminEmail: auth.user.email ?? '',
    })
  } catch (err) {
    return apiError('admin.stats_failed', err, { path: 'admin_review' })
  }
}
