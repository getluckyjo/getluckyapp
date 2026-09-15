import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { MOCK_ADMIN_VERIFICATIONS } from '@/lib/admin-mock-data'
import type { VerificationQueueItem, PaginatedResponse } from '@/types/admin'

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const tier = searchParams.get('tier')
    const sort = searchParams.get('sort') || 'oldest'
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit = Math.min(50, parseInt(searchParams.get('limit') ?? '20', 10))

    if (auth.isMock || !auth.adminClient) {
      let filtered = [...MOCK_ADMIN_VERIFICATIONS]
      if (status) filtered = filtered.filter(v => v.status === status)
      if (tier) filtered = filtered.filter(v => v.tier === tier)

      if (sort === 'oldest') filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      else if (sort === 'newest') filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      else if (sort === 'highest') filtered.sort((a, b) => b.potentialWinCents - a.potentialWinCents)

      const total = filtered.length
      const start = (page - 1) * limit
      const data = filtered.slice(start, start + limit)

      const resp: PaginatedResponse<VerificationQueueItem> = {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
      return NextResponse.json(resp)
    }

    // Real DB query — use separate queries to avoid fragile nested joins
    const adminClient = auth.adminClient

    // Step 1: Query verifications
    let verifQuery = adminClient
      .from('verifications')
      .select('*', { count: 'exact' })

    if (status) verifQuery = verifQuery.eq('status', status)
    if (sort === 'oldest') verifQuery = verifQuery.order('created_at', { ascending: true })
    else if (sort === 'newest') verifQuery = verifQuery.order('created_at', { ascending: false })

    const offset = (page - 1) * limit
    verifQuery = verifQuery.range(offset, offset + limit - 1)

    const { data: verifs, count: verifCount, error: verifError } = await verifQuery

    if (verifError) {
      return NextResponse.json({ error: verifError.message }, { status: 500 })
    }

    const verifRows = verifs ?? []

    // Step 2: Fetch related bets
    const betIds = [...new Set(verifRows.map((v: { bet_id: string }) => v.bet_id).filter(Boolean))]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const betsMap: Record<string, any> = {}
    if (betIds.length > 0) {
      const { data: betsData } = await adminClient
        .from('bets')
        .select('id, user_id, course_id, hole_id, tier, stake_pence, potential_win_pence, video_url, declared_at')
        .in('id', betIds)
      for (const b of betsData ?? []) {
        betsMap[b.id] = b
      }
    }

    // Step 3: Fetch related courses, holes, profiles
    const courseIds = [...new Set(Object.values(betsMap).map((b) => b.course_id).filter(Boolean))]
    const holeIds = [...new Set(Object.values(betsMap).map((b) => b.hole_id).filter(Boolean))]
    const userIds = [...new Set(Object.values(betsMap).map((b) => b.user_id).filter(Boolean))]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coursesMap: Record<string, any> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const holesMap: Record<string, any> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profilesMap: Record<string, any> = {}

    const [coursesRes, holesRes, profilesRes] = await Promise.all([
      courseIds.length > 0
        ? adminClient.from('courses').select('id, name').in('id', courseIds)
        : Promise.resolve({ data: [] }),
      holeIds.length > 0
        ? adminClient.from('holes').select('id, hole_number').in('id', holeIds)
        : Promise.resolve({ data: [] }),
      userIds.length > 0
        ? adminClient.from('profiles').select('id, name').in('id', userIds)
        : Promise.resolve({ data: [] }),
    ])

    for (const c of coursesRes.data ?? []) coursesMap[c.id] = c
    for (const h of holesRes.data ?? []) holesMap[h.id] = h
    for (const p of profilesRes.data ?? []) profilesMap[p.id] = p

    // Step 4: Combine
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: VerificationQueueItem[] = verifRows.map((row: any) => {
      const bet = betsMap[row.bet_id]
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
        userName: bet?.user_id ? profilesMap[bet.user_id]?.name : null,
        userId: bet?.user_id,
        courseName: bet?.course_id ? coursesMap[bet.course_id]?.name : null,
        holeNumber: bet?.hole_id ? holesMap[bet.hole_id]?.hole_number : null,
        createdAt: row.created_at,
        declaredAt: bet?.declared_at,
        documentsReceivedAt: row.documents_received_at,
        reviewerNotes: row.reviewer_notes,
        reviewedBy: row.reviewed_by,
        verifiedAt: row.verified_at,
        payoutInitiatedAt: row.payout_initiated_at,
      }
    })

    // Post-filter by tier if needed
    if (tier) {
      const filtered = data.filter(d => d.tier === tier)
      return NextResponse.json({
        data: filtered,
        total: filtered.length,
        page,
        limit,
        totalPages: Math.ceil(filtered.length / limit),
      })
    }

    return NextResponse.json({
      data,
      total: verifCount ?? data.length,
      page,
      limit,
      totalPages: Math.ceil((verifCount ?? data.length) / limit),
    })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
