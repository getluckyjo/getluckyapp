import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import { assertNotSuspended, assertOpen, claimErrorResponse, transitionBet } from '@/lib/claims/state-machine'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { apiError, parseBody } from '@/lib/api/http'

const Body = z.object({ status: z.enum(['miss', 'claimed']) })

/**
 * PATCH /api/bets/[betId]
 * Body: { status: 'miss' | 'claimed' }
 *
 * The player resolves an active bet. `declared_result` and `declared_at`
 * are derived server-side. Retrying the same resolution is a no-op (200);
 * any other change to a resolved bet is a 409; a bet past its window is 410.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ betId: string }> }
) {
  try {
    const { betId } = await params

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const limited = await enforceRateLimit(RULES.claim, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited
    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { status } = body.data

    // RLS shows the caller only their own bets: this is the ownership check.
    const { data: bet } = await supabase
      .from('bets')
      .select('id, status, declared_result, expires_at')
      .eq('id', betId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!bet) {
      return NextResponse.json({ error: 'Bet not found' }, { status: 404 })
    }

    const declaredResult = status === 'miss' ? 'miss' : 'win'

    // Idempotent retry (the miss screen fires this on mount).
    if (bet.status === status && bet.declared_result === declaredResult) {
      return NextResponse.json({ success: true, alreadyDone: true })
    }

    await assertNotSuspended(supabase, user.id)
    assertOpen(bet)

    await transitionBet(createAdminClient(), {
      betId,
      from: 'active',
      to: status,
      actor: 'player',
      actorId: user.id,
      userId: user.id,
      extra: { declared_result: declaredResult, declared_at: new Date().toISOString() },
    })

    log.info('claim.declared', { user_id: user.id, bet_id: betId, status, declared_result: declaredResult })
    return NextResponse.json({ success: true, source: 'database' })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    await alertOps({ event: 'claim.declare_failed', path: 'claim', summary: 'A result declaration could not be saved.', err })
    return apiError('claim.declare_unhandled', err, { path: 'claim', message: 'Could not save your result.' })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ betId: string }> }
) {
  try {
    const { betId } = await params

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: bet, error } = await supabase
      .from('bets')
      .select('*')
      .eq('id', betId)
      .eq('user_id', user.id)
      .single()

    if (error) return NextResponse.json({ bet: null, error: 'Not found' })
    return NextResponse.json({ bet, source: 'database' })
  } catch (err) {
    return apiError('bets.detail_failed', err, { message: 'Could not load this bet.' })
  }
}
