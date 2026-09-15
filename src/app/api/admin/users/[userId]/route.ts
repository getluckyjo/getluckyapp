import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { BET_SELECT, namesForBets, toAdminBetRecord, type BetRowLike } from '@/lib/admin/data'
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

    const { data: betsRaw, error: betsErr } = await auth.adminClient
      .from('bets')
      .select(BET_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (betsErr) throw betsErr
    const bets = (betsRaw ?? []) as BetRowLike[]
    const names = await namesForBets(auth.adminClient, bets)

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
      },
      bets: bets.map(b => toAdminBetRecord(b, names)),
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
      ? { suspended_at: new Date().toISOString(), suspended_reason: body.data.reason ?? null }
      : { suspended_at: null, suspended_reason: null }
    const { data, error } = await auth.adminClient.from('profiles').update(updates).eq('id', userId).select('id')
    if (error) throw error
    if (!data || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    log.info('admin.user_suspension', { admin_id: auth.user.id, user_id: userId, suspended: body.data.suspended, reason: body.data.reason ?? null })
    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError('admin.users.update_failed', err, { path: 'admin_review' })
  }
}
