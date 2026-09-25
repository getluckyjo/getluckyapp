import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, parseQuery, uuid } from '@/lib/api/http'
import { BET_SELECT, toAdminBetRecord, type BetRowLike, type Names } from '@/lib/admin/data'
import { PAYMENT_SELECT, betsByReference, toPaymentRecord, type PaymentNames, type PaymentRowLike } from '@/lib/admin/payments'
import { log } from '@/lib/observability/log'
import { betTotals } from '../queries'

type Params = { params: Promise<{ userId: string }> }

/** Bets per page of the golfer's history. */
const BETS_PER_PAGE = 50

const Query = z.object({ betsPage: z.coerce.number().int().min(1).default(1) })

const unique = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((x): x is string => !!x))]

/**
 * GET — a golfer: profile, totals over all their bets, a page of bets with
 * any claim each one made, and their latest payments.
 *
 * Two round trips: everything keyed by the user id at once, then the names
 * and claims those rows point at. The golfer's own name comes from the
 * profile already read, not a second read of profiles.
 */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { userId } = await params
  if (!uuid.safeParse(userId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const q = parseQuery(request.url, Query)
  if (!q.ok) return q.response
  const { betsPage } = q.data
  const admin = auth.adminClient

  try {
    const offset = (betsPage - 1) * BETS_PER_PAGE
    const [profileRes, betsRes, paymentsRes, cardRes, totals] = await Promise.all([
      admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
      admin.from('bets').select(BET_SELECT, { count: 'exact' }).eq('user_id', userId).order('created_at', { ascending: false }).range(offset, offset + BETS_PER_PAGE - 1),
      admin.from('payfast_payments').select(PAYMENT_SELECT).eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
      admin.from('payment_cards').select('label, created_at, last_used_at').eq('user_id', userId).maybeSingle(),
      betTotals(admin, [userId]),
    ])
    for (const r of [profileRes, betsRes, paymentsRes, cardRes]) if (r.error) throw r.error
    const profile = profileRes.data
    if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const bets = (betsRes.data ?? []) as unknown as BetRowLike[]
    const paymentRows = (paymentsRes.data ?? []) as unknown as PaymentRowLike[]
    const courseIds = unique([...bets.map(b => b.course_id), ...paymentRows.map(p => p.course_id)])
    const holeIds = unique([...bets.map(b => b.hole_id), ...paymentRows.map(p => p.hole_id)])
    const none = Promise.resolve({ data: [], error: null })

    const [coursesRes, holesRes, claimsRes, byReference] = await Promise.all([
      courseIds.length ? admin.from('courses').select('id, name').in('id', courseIds) : none,
      holeIds.length ? admin.from('holes').select('id, hole_number').in('id', holeIds) : none,
      bets.length ? admin.from('verifications').select('id, bet_id, status').in('bet_id', bets.map(b => b.id)) : none,
      // The bet each payment produced, by reference when the ledger's own link was never written.
      betsByReference(admin, paymentRows),
    ])
    for (const r of [coursesRes, holesRes, claimsRes]) if (r.error) throw r.error

    const courses = new Map(((coursesRes.data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]))
    const holes = new Map(((holesRes.data ?? []) as { id: string; hole_number: number }[]).map(h => [h.id, h.hole_number]))
    const claims = new Map(((claimsRes.data ?? []) as { id: string; bet_id: string; status: string }[]).map(v => [v.bet_id, { id: v.id, status: v.status }]))
    const names: Names = { users: new Map([[userId, profile.name]]), courses, holes }
    const paymentNames: PaymentNames = { users: new Map([[userId, { name: profile.name, email: profile.email }]]), courses, holes }

    const payments = paymentRows.map(r => {
      const record = toPaymentRecord(r, paymentNames)
      return record.betId ? record : { ...record, betId: byReference.get(r.m_payment_id) ?? null }
    })
    const card = cardRes.data as { label: string; created_at: string; last_used_at: string | null } | null
    const total = totals.get(userId) ?? { staked: 0, won: 0, bets: 0 }

    return NextResponse.json({
      user: {
        id: profile.id,
        name: profile.name,
        email: profile.email ?? '',
        handicap: profile.handicap,
        totalAttempts: profile.total_attempts ?? 0,
        totalStaked: total.staked,
        totalWon: total.won,
        paymentMethod: profile.payment_method,
        isAdmin: profile.is_admin ?? false,
        suspendedAt: profile.suspended_at,
        suspendedReason: profile.suspended_reason,
        createdAt: profile.created_at,
        ageVerifiedAt: profile.age_verified_at ?? null,
        savedCard: card ? { label: card.label, savedAt: card.created_at, lastUsedAt: card.last_used_at } : null,
      },
      bets: bets.map(b => ({ ...toAdminBetRecord(b, names), claim: claims.get(b.id) ?? null })),
      betsTotal: betsRes.count ?? bets.length,
      betsPage,
      betsPerPage: BETS_PER_PAGE,
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
  if (!uuid.safeParse(userId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response

  if (userId === auth.user.id && body.data.suspended) {
    return NextResponse.json({ error: 'You cannot suspend your own account', code: 'SELF_SUSPEND' }, { status: 409 })
  }

  try {
    const updates = body.data.suspended
      ? { suspended_at: new Date().toISOString(), suspended_reason: body.data.reason || null, updated_by: auth.user.id }
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
