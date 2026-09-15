import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { BET_SELECT, namesForBets, toAdminBetRecord, type BetRowLike } from '@/lib/admin/data'
import { BET_STATUSES, canTransitionBet, claimErrorResponse, isBetStatus, transitionBet } from '@/lib/claims/state-machine'
import { log } from '@/lib/observability/log'

type Params = { params: Promise<{ betId: string }> }

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { betId } = await params
  if (!uuid.safeParse(betId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const { data, error } = await auth.adminClient.from('bets').select(BET_SELECT).eq('id', betId).maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const bet = data as BetRowLike
    const names = await namesForBets(auth.adminClient, [bet])
    return NextResponse.json(toAdminBetRecord(bet, names))
  } catch (err) {
    return apiError('admin.bets.detail_failed', err, { path: 'admin_review' })
  }
}

const Body = z.object({
  status: z.enum(BET_STATUSES),
  /** The bank or PayFast reference. Required when confirming a payout. */
  payoutReference: z.string().trim().max(120).optional(),
})

/**
 * The only direct admin change to a bet is confirming a payout
 * (verified → paid). Results are declared by the player, approval goes
 * through the verification queue; both land in claim_events with the actor.
 */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { betId } = await params
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response

  const payoutReference = body.data.payoutReference ?? ''

  try {
    const { data: bet } = await auth.adminClient.from('bets').select('id, status').eq('id', betId).maybeSingle()
    if (!bet) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!isBetStatus(bet.status) || !canTransitionBet('admin', bet.status, body.data.status)) {
      return NextResponse.json(
        { error: `An admin cannot move a bet from ${bet.status} to ${body.data.status}. Results are declared by the player; approval goes through the verification queue.`, code: 'INVALID_TRANSITION' },
        { status: 409 },
      )
    }
    if (body.data.status === 'paid' && payoutReference.length < 3) {
      return NextResponse.json({ error: 'Enter the bank or PayFast reference for the payout. "Paid" is never recorded without one.', code: 'PAYOUT_REFERENCE_REQUIRED' }, { status: 400 })
    }

    const now = new Date().toISOString()
    await transitionBet(auth.adminClient, {
      betId, from: bet.status, to: body.data.status, actor: 'admin', actorId: auth.user.id,
      extra: body.data.status === 'paid' ? { payout_reference: payoutReference } : {},
    })
    if (body.data.status === 'paid') {
      const { error } = await auth.adminClient.from('verifications').update({ payout_initiated_at: now, updated_by: auth.user.id }).eq('bet_id', betId)
      if (error) log.error('admin.payout_timestamp_failed', error, { path: 'admin_review', bet_id: betId })
    }
    log.info('admin.bet_transition', { admin_id: auth.user.id, bet_id: betId, from: bet.status, to: body.data.status, payout_reference: body.data.status === 'paid' ? payoutReference : undefined })
    return NextResponse.json({ success: true, betId })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('admin.bets.patch_failed', err, { path: 'admin_review' })
  }
}
