import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { BET_SELECT, namesForBets, toAdminBetRecord, type BetRowLike } from '@/lib/admin/data'
import { PAYMENT_SELECT, namesForPayments, toPaymentRecord, type PaymentRowLike } from '@/lib/admin/payments'
import type { AdminBetDetail, ClaimEvent } from '@/types/admin'
import type { RiskFlag } from '@/lib/risk/labels'
import { BET_STATUSES, canTransitionBet, claimErrorResponse, isBetStatus, transitionBet } from '@/lib/claims/state-machine'
import { log } from '@/lib/observability/log'

type Params = { params: Promise<{ betId: string }> }

/**
 * GET — one bet with everything a reviewer needs beside it: the payment that
 * bought it, the footage, the risk flags, the claim it opened, the golfer,
 * and the audit trail. One call, so the screen never half-renders.
 */
export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { betId } = await params
  if (!uuid.safeParse(betId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const admin = auth.adminClient

  try {
    const { data, error } = await admin
      .from('bets')
      .select(`${BET_SELECT}, expires_at, video_sha256, video_bytes, video_uploaded_at`)
      .eq('id', betId)
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const bet = data as BetRowLike & {
      expires_at: string | null
      video_sha256: string | null
      video_bytes: number | null
      video_uploaded_at: string | null
    }

    const [names, paymentRes, verificationRes, profileRes, eventsRes, videoSignedUrl] = await Promise.all([
      namesForBets(admin, [bet]),
      // The ledger links by bet_id, but that link is best-effort; the bet's
      // own reference is the one that is never rewritten.
      bet.payment_intent_id
        ? admin.from('payfast_payments').select(PAYMENT_SELECT).eq('m_payment_id', bet.payment_intent_id).maybeSingle()
        : admin.from('payfast_payments').select(PAYMENT_SELECT).eq('bet_id', betId).maybeSingle(),
      admin.from('verifications').select('id, status').eq('bet_id', betId).maybeSingle(),
      admin.from('profiles').select('id, name, email, suspended_at, age_verified_at, total_attempts').eq('id', bet.user_id).maybeSingle(),
      admin.from('claim_events').select('id, table_name, action, actor_id, actor_role, changed, created_at').eq('bet_id', betId).order('created_at', { ascending: true }).limit(200),
      bet.video_url
        ? admin.storage.from('shot-videos').createSignedUrl(bet.video_url, 3600).then(r => r.data?.signedUrl ?? null)
        : Promise.resolve(null),
    ])

    const paymentRow = paymentRes.data as PaymentRowLike | null
    const paymentNames = paymentRow ? await namesForPayments(admin, [paymentRow]) : null
    const profile = profileRes.data as
      | { id: string; name: string | null; email: string | null; suspended_at: string | null; age_verified_at: string | null; total_attempts: number | null }
      | null

    const detail: AdminBetDetail = {
      ...toAdminBetRecord(bet, names),
      expiresAt: bet.expires_at,
      payoutReference: bet.payout_reference ?? null,
      videoSignedUrl,
      videoSha256: bet.video_sha256,
      videoBytes: bet.video_bytes,
      videoUploadedAt: bet.video_uploaded_at,
      riskScore: bet.risk_score ?? 0,
      riskFlags: Array.isArray(bet.risk_flags) ? (bet.risk_flags as RiskFlag[]) : [],
      payment: paymentRow && paymentNames ? toPaymentRecord(paymentRow, paymentNames) : null,
      verificationId: verificationRes.data?.id ?? null,
      verificationStatus: verificationRes.data?.status ?? null,
      user: {
        id: bet.user_id,
        name: profile?.name ?? null,
        email: profile?.email ?? '',
        suspendedAt: profile?.suspended_at ?? null,
        ageVerifiedAt: profile?.age_verified_at ?? null,
        totalAttempts: profile?.total_attempts ?? 0,
      },
      events: (eventsRes.data ?? []) as ClaimEvent[],
    }
    return NextResponse.json(detail)
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
