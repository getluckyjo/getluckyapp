import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { BET_SELECT, namesForBets, toAdminBetRecord, type BetRowLike } from '@/lib/admin/data'
import { PAYMENT_SELECT, betsByReference, namesForPayments, toPaymentRecord, type PaymentRowLike } from '@/lib/admin/payments'
import { log } from '@/lib/observability/log'

type Params = { params: Promise<{ userId: string }> }

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { userId } = await params
  if (!uuid.safeParse(userId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const { data: profile, error } = await auth.adminClient.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) throw error
    if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const admin = auth.adminClient
    const [betsRes, paymentsRes, cardRes] = await Promise.all([
      admin.from('bets').select(BET_SELECT).eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
      admin.from('payfast_payments').select(PAYMENT_SELECT).eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
      admin.from('payment_cards').select('label, created_at, last_used_at').eq('user_id', userId).maybeSingle(),
    ])
    if (betsRes.error) throw betsRes.error
    const bets = (betsRes.data ?? []) as BetRowLike[]
    const names = await namesForBets(admin, bets)

    // The golfer's money, with the bet each payment produced (by reference
    // when the ledger's own link was never written).
    const paymentRows = (paymentsRes.data ?? []) as PaymentRowLike[]
    const [paymentNames, byReference] = await Promise.all([
      namesForPayments(admin, paymentRows),
      betsByReference(admin, paymentRows),
    ])
    const payments = paymentRows.map(r => {
      const record = toPaymentRecord(r, paymentNames)
      return record.betId ? record : { ...record, betId: byReference.get(r.m_payment_id) ?? null }
    })
    const card = cardRes.data as { label: string; created_at: string; last_used_at: string | null } | null

    const totalStaked = bets.reduce((s, b) => s + (b.stake_pence ?? 0), 0)
    const totalWon = bets.filter(b => b.status === 'paid' || b.status === 'verified').reduce((s, b) => s + (b.potential_win_pence ?? 0), 0)

    return NextResponse.json({
      user: {
        id: profile.id,
        name: profile.name,
        email: profile.email ?? '',
        handicap: profile.handicap,
        totalAttempts: profile.total_attempts ?? 0,
        totalStaked,
        totalWon,
        paymentMethod: profile.payment_method,
        isAdmin: profile.is_admin ?? false,
        suspendedAt: profile.suspended_at,
        suspendedReason: profile.suspended_reason,
        createdAt: profile.created_at,
        ageVerifiedAt: profile.age_verified_at ?? null,
        savedCard: card ? { label: card.label, savedAt: card.created_at, lastUsedAt: card.last_used_at } : null,
      },
      bets: bets.map(b => toAdminBetRecord(b, names)),
      payments,
    })
  } catch (err) {
    return apiError('admin.users.detail_failed', err, { path: 'admin_review' })
  }
}

const Body = z.object({
  suspended: z.boolean(),
  reason: z.string().trim().max(500).optional(),
})

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { userId } = await params
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response

  if (userId === auth.user.id && body.data.suspended) {
    return NextResponse.json({ error: 'You cannot suspend your own account', code: 'SELF_SUSPEND' }, { status: 409 })
  }

  try {
    const updates = body.data.suspended
      ? { suspended_at: new Date().toISOString(), suspended_reason: body.data.reason ?? null, updated_by: auth.user.id }
      : { suspended_at: null, suspended_reason: null, updated_by: auth.user.id }
    const { data, error } = await auth.adminClient.from('profiles').update(updates).eq('id', userId).select('id')
    if (error) throw error
    if (!data || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    log.info('admin.user_suspension', { admin_id: auth.user.id, user_id: userId, suspended: body.data.suspended, reason: body.data.reason ?? null })
    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError('admin.users.update_failed', err, { path: 'admin_review' })
  }
}
