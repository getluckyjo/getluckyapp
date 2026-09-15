import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { BET_SELECT, namesForBets, toAdminBetRecord, toQueueItem, type BetRowLike, type VerificationRowLike } from '@/lib/admin/data'
import { VERIFICATION_STATUSES, claimErrorResponse, reviewVerification } from '@/lib/claims/state-machine'
import { log } from '@/lib/observability/log'
import type { VerificationDetail } from '@/types/admin'

type Params = { params: Promise<{ verificationId: string }> }

interface BetDetailRow extends BetRowLike {
  expires_at: string | null
  video_sha256: string | null
  video_bytes: number | null
  video_uploaded_at: string | null
}

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { verificationId } = await params
  if (!uuid.safeParse(verificationId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const admin = auth.adminClient

  try {
    const { data: rowRaw, error } = await admin.from('verifications').select('*').eq('id', verificationId).maybeSingle()
    if (error) throw error
    if (!rowRaw) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const row = rowRaw as VerificationRowLike

    const { data: betRaw } = await admin
      .from('bets')
      .select(`${BET_SELECT}, expires_at, video_sha256, video_bytes, video_uploaded_at`)
      .eq('id', row.bet_id)
      .maybeSingle()
    const bet = (betRaw ?? undefined) as BetDetailRow | undefined

    const [historyRes, profileRes, eventsRes] = await Promise.all([
      bet ? admin.from('bets').select(BET_SELECT).eq('user_id', bet.user_id).order('created_at', { ascending: false }).limit(5) : Promise.resolve({ data: [] as BetRowLike[] }),
      bet ? admin.from('profiles').select('total_attempts').eq('id', bet.user_id).maybeSingle() : Promise.resolve({ data: null }),
      admin.from('claim_events').select('id, table_name, action, actor_id, actor_role, changed, created_at').eq('bet_id', row.bet_id).order('created_at', { ascending: true }).limit(200),
    ])
    const history = (historyRes.data ?? []) as BetRowLike[]
    const names = await namesForBets(admin, bet ? [bet, ...history] : history)

    const sign = async (bucket: string, path: string | null) => {
      if (!path) return null
      const { data } = await admin.storage.from(bucket).createSignedUrl(path, 3600)
      return data?.signedUrl ?? null
    }
    const [videoSignedUrl, certificateSignedUrl, affidavitSignedUrl] = await Promise.all([
      sign('shot-videos', bet?.video_url ?? null),
      sign('verification-docs', row.certificate_path),
      sign('verification-docs', row.affidavit_path),
    ])

    const detail: VerificationDetail = {
      ...toQueueItem(row, bet, names),
      videoSignedUrl,
      certificateSignedUrl,
      affidavitSignedUrl,
      userBetHistory: history.map(b => toAdminBetRecord(b, names)),
      userTotalAttempts: profileRes.data?.total_attempts ?? 0,
      betStatus: bet?.status ?? null,
      betCreatedAt: bet?.created_at ?? null,
      betExpiresAt: bet?.expires_at ?? null,
      videoSha256: bet?.video_sha256 ?? null,
      videoBytes: bet?.video_bytes ?? null,
      videoUploadedAt: bet?.video_uploaded_at ?? null,
      events: eventsRes.data ?? [],
    }
    return NextResponse.json(detail)
  } catch (err) {
    return apiError('admin.verifications.detail_failed', err, { path: 'admin_review' })
  }
}

const Body = z.object({
  status: z.enum(VERIFICATION_STATUSES),
  reviewerNotes: z.string().trim().max(2000).optional(),
})

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { verificationId } = await params
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response

  try {
    const { betId } = await reviewVerification(auth.adminClient, {
      verificationId,
      to: body.data.status,
      actorId: auth.user.id,
      notes: body.data.reviewerNotes,
    })
    log.info('admin.review', { admin_id: auth.user.id, verification_id: verificationId, bet_id: betId, status: body.data.status })
    return NextResponse.json({ success: true, verificationId, newStatus: body.data.status })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('admin.review_failed', err, { path: 'admin_review' })
  }
}
