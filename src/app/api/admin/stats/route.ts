import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { MOCK_ADMIN_STATS } from '@/lib/admin-mock-data'

export async function GET() {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    if (auth.isMock || !auth.adminClient) {
      return NextResponse.json({
        ...MOCK_ADMIN_STATS,
        adminName: 'Admin User',
        adminEmail: 'admin@getlucky.golf',
      })
    }

    const adminClient = auth.adminClient

    // Total revenue (sum of all stakes for bets with payment confirmed)
    const { data: allBets } = await adminClient
      .from('bets')
      .select('stake_pence, potential_win_pence, status')

    const bets = allBets ?? []
    const totalRevenue = bets.reduce((sum, b) => sum + (b.stake_pence ?? 0), 0)
    const activeBets = bets.filter(b => b.status === 'active').length
    const totalPayouts = bets
      .filter(b => b.status === 'paid')
      .reduce((sum, b) => sum + (b.potential_win_pence ?? 0), 0)

    // Pending claims
    const { count: pendingClaims } = await adminClient
      .from('verifications')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'documents_received', 'under_review'])

    // Total users
    const { count: totalUsers } = await adminClient
      .from('profiles')
      .select('id', { count: 'exact', head: true })

    // Recent bets
    const { data: recentBetsRaw } = await adminClient
      .from('bets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5)

    const rbets = recentBetsRaw ?? []
    // Fetch related names for recent bets
    const rbCourseIds = [...new Set(rbets.map((b: { course_id: string }) => b.course_id).filter(Boolean))]
    const rbHoleIds = [...new Set(rbets.map((b: { hole_id: string }) => b.hole_id).filter(Boolean))]
    const rbUserIds = [...new Set(rbets.map((b: { user_id: string }) => b.user_id).filter(Boolean))]

    const [rbCoursesRes, rbHolesRes, rbProfilesRes] = await Promise.all([
      rbCourseIds.length > 0 ? adminClient.from('courses').select('id, name').in('id', rbCourseIds) : Promise.resolve({ data: [] }),
      rbHoleIds.length > 0 ? adminClient.from('holes').select('id, hole_number').in('id', rbHoleIds) : Promise.resolve({ data: [] }),
      rbUserIds.length > 0 ? adminClient.from('profiles').select('id, name').in('id', rbUserIds) : Promise.resolve({ data: [] }),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rbCoursesMap: Record<string, any> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rbHolesMap: Record<string, any> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rbProfilesMap: Record<string, any> = {}
    for (const c of rbCoursesRes.data ?? []) rbCoursesMap[c.id] = c
    for (const h of rbHolesRes.data ?? []) rbHolesMap[h.id] = h
    for (const p of rbProfilesRes.data ?? []) rbProfilesMap[p.id] = p

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recentBets = rbets.map((b: any) => ({
      id: b.id,
      userId: b.user_id,
      userName: rbProfilesMap[b.user_id]?.name,
      tier: b.tier,
      stakeCents: b.stake_pence,
      potentialWinCents: b.potential_win_pence,
      status: b.status,
      declaredResult: b.declared_result,
      declaredAt: b.declared_at,
      videoUrl: b.video_url,
      paymentIntentId: b.payment_intent_id,
      courseName: rbCoursesMap[b.course_id]?.name ?? '',
      courseId: b.course_id,
      holeNumber: rbHolesMap[b.hole_id]?.hole_number ?? 0,
      holeId: b.hole_id,
      createdAt: b.created_at,
    }))

    // Recent verifications
    const { data: recentVerifsRaw } = await adminClient
      .from('verifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3)

    const rverifs = recentVerifsRaw ?? []
    // Fetch related bet data for recent verifications
    const rvBetIds = [...new Set(rverifs.map((v: { bet_id: string }) => v.bet_id).filter(Boolean))]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rvBetsMap: Record<string, any> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rvCoursesMap: Record<string, any> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rvHolesMap: Record<string, any> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rvProfilesMap: Record<string, any> = {}

    if (rvBetIds.length > 0) {
      const { data: rvBetsData } = await adminClient
        .from('bets')
        .select('id, user_id, course_id, hole_id, tier, stake_pence, potential_win_pence, video_url, declared_at')
        .in('id', rvBetIds)
      for (const b of rvBetsData ?? []) rvBetsMap[b.id] = b

      const rvCourseIds = [...new Set(Object.values(rvBetsMap).map((b) => b.course_id).filter(Boolean))]
      const rvHoleIds = [...new Set(Object.values(rvBetsMap).map((b) => b.hole_id).filter(Boolean))]
      const rvUserIds = [...new Set(Object.values(rvBetsMap).map((b) => b.user_id).filter(Boolean))]

      const [rvCR, rvHR, rvPR] = await Promise.all([
        rvCourseIds.length > 0 ? adminClient.from('courses').select('id, name').in('id', rvCourseIds) : Promise.resolve({ data: [] }),
        rvHoleIds.length > 0 ? adminClient.from('holes').select('id, hole_number').in('id', rvHoleIds) : Promise.resolve({ data: [] }),
        rvUserIds.length > 0 ? adminClient.from('profiles').select('id, name').in('id', rvUserIds) : Promise.resolve({ data: [] }),
      ])
      for (const c of rvCR.data ?? []) rvCoursesMap[c.id] = c
      for (const h of rvHR.data ?? []) rvHolesMap[h.id] = h
      for (const p of rvPR.data ?? []) rvProfilesMap[p.id] = p
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recentVerifications = rverifs.map((row: any) => {
      const bet = rvBetsMap[row.bet_id]
      return {
        id: row.id,
        betId: row.bet_id,
        status: row.status,
        tier: bet?.tier,
        stakeCents: bet?.stake_pence,
        potentialWinCents: bet?.potential_win_pence,
        videoUrl: bet?.video_url,
        certificatePath: row.certificate_path,
        affidavitPath: row.affidavit_path,
        userName: bet?.user_id ? rvProfilesMap[bet.user_id]?.name : null,
        userId: bet?.user_id,
        courseName: bet?.course_id ? rvCoursesMap[bet.course_id]?.name : null,
        holeNumber: bet?.hole_id ? rvHolesMap[bet.hole_id]?.hole_number : null,
        createdAt: row.created_at,
        declaredAt: bet?.declared_at,
        documentsReceivedAt: row.documents_received_at,
        reviewerNotes: row.reviewer_notes,
        reviewedBy: row.reviewed_by,
        verifiedAt: row.verified_at,
        payoutInitiatedAt: row.payout_initiated_at,
      }
    })

    // Get admin info
    let adminName = 'Admin'
    let adminEmail = ''
    if (auth.user) {
      const { data: profile } = await adminClient
        .from('profiles')
        .select('name')
        .eq('id', auth.user.id)
        .single()
      adminName = profile?.name || 'Admin'
      adminEmail = auth.user.email || ''
    }

    return NextResponse.json({
      totalRevenue,
      activeBets,
      pendingClaims: pendingClaims ?? 0,
      totalPayouts,
      totalUsers: totalUsers ?? 0,
      recentBets,
      recentVerifications,
      adminName,
      adminEmail,
    })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
