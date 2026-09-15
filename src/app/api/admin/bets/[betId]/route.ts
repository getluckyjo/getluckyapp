import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { MOCK_ADMIN_BETS } from '@/lib/admin-mock-data'
import { canTransitionBet, claimErrorResponse, isBetStatus, transitionBet } from '@/lib/claims/state-machine'
import { log } from '@/lib/observability/log'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ betId: string }> }
) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const { betId } = await params

    if (auth.isMock || !auth.adminClient) {
      const bet = MOCK_ADMIN_BETS.find(b => b.id === betId)
      if (!bet) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(bet)
    }

    const adminClient = auth.adminClient
    const { data: bet, error } = await adminClient
      .from('bets')
      .select('*')
      .eq('id', betId)
      .single()

    if (error || !bet) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Fetch related data separately
    const [profileRes, courseRes, holeRes] = await Promise.all([
      bet.user_id ? adminClient.from('profiles').select('name').eq('id', bet.user_id).single() : Promise.resolve({ data: null }),
      bet.course_id ? adminClient.from('courses').select('name').eq('id', bet.course_id).single() : Promise.resolve({ data: null }),
      bet.hole_id ? adminClient.from('holes').select('hole_number').eq('id', bet.hole_id).single() : Promise.resolve({ data: null }),
    ])

    return NextResponse.json({
      id: bet.id,
      userId: bet.user_id,
      userName: profileRes.data?.name ?? null,
      tier: bet.tier,
      stakeCents: bet.stake_pence,
      potentialWinCents: bet.potential_win_pence,
      status: bet.status,
      declaredResult: bet.declared_result,
      declaredAt: bet.declared_at,
      videoUrl: bet.video_url,
      paymentIntentId: bet.payment_intent_id,
      courseName: courseRes.data?.name ?? '',
      courseId: bet.course_id,
      holeNumber: holeRes.data?.hole_number ?? 0,
      holeId: bet.hole_id,
      createdAt: bet.created_at,
    })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ betId: string }> }
) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const { betId } = await params
    const body = await request.json()

    if (auth.isMock || !auth.adminClient) {
      return NextResponse.json({ success: true, source: 'mock', betId })
    }

    // The only direct admin change to a bet is confirming a payout
    // (verified → paid). Results are set by the player, approval by review;
    // both are recorded in claim_events with the actor.
    if (!isBetStatus(body.status)) {
      return NextResponse.json({ error: 'Invalid status value' }, { status: 400 })
    }
    const { data: bet } = await auth.adminClient.from('bets').select('id, status').eq('id', betId).maybeSingle()
    if (!bet) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!isBetStatus(bet.status) || !canTransitionBet('admin', bet.status, body.status)) {
      return NextResponse.json(
        { error: `An admin cannot move a bet from ${bet.status} to ${body.status}. Results are declared by the player; approval goes through the verification queue.`, code: 'INVALID_TRANSITION' },
        { status: 409 },
      )
    }

    await transitionBet(auth.adminClient, { betId, from: bet.status, to: body.status, actor: 'admin', actorId: auth.user.id })
    log.info('admin.bet_transition', { admin_id: auth.user.id, bet_id: betId, from: bet.status, to: body.status })
    return NextResponse.json({ success: true, betId })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    log.error('admin.bet_patch_failed', err, { path: 'admin_review' })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
