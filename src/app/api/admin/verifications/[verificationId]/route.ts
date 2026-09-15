import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { BET_SELECT, namesForBets, toAdminBetRecord, toQueueItem, type BetRowLike, type VerificationRowLike } from '@/lib/admin/data'
import { VERIFICATION_STATUSES, claimErrorResponse, reviewVerification } from '@/lib/claims/state-machine'
import { log } from '@/lib/observability/log'
import { witnessesForBet } from '@/lib/claims/witnesses'
import { ChecklistSchema, MIN_DECISION_NOTES } from '@/lib/claims/checklist'
import { tryRefreshClaimRisk } from '@/lib/risk/rules'
import type { CaptureAttestation, VerificationDetail } from '@/types/admin'

type Params = { params: Promise<{ verificationId: string }> }

interface BetDetailRow extends BetRowLike {
  expires_at: string | null
  video_sha256: string | null
  video_bytes: number | null
  video_uploaded_at: string | null
  capture_started_at: string | null
  capture_ended_at: string | null
  capture_duration_ms: number | null
  capture_lat: number | null
  capture_lng: number | null
  capture_accuracy_m: number | null
  capture_distance_m: number | null
  capture_user_agent: string | null
}

const CAPTURE_COLUMNS = 'capture_started_at, capture_ended_at, capture_duration_ms, capture_lat, capture_lng, capture_accuracy_m, capture_distance_m, capture_user_agent'

function captureOf(bet: BetDetailRow | undefined): CaptureAttestation {
  const endedAt = bet?.capture_ended_at ?? null
  const sealedAt = bet?.video_uploaded_at ?? null
  return {
    startedAt: bet?.capture_started_at ?? null,
    endedAt,
    durationMs: bet?.capture_duration_ms ?? null,
    lat: bet?.capture_lat ?? null,
    lng: bet?.capture_lng ?? null,
    accuracyM: bet?.capture_accuracy_m ?? null,
    distanceM: bet?.capture_distance_m ?? null,
    userAgent: bet?.capture_user_agent ?? null,
    uploadLagS: endedAt && sealedAt ? Math.round((Date.parse(sealedAt) - Date.parse(endedAt)) / 1000) : null,
  }
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
      .select(`${BET_SELECT}, expires_at, video_sha256, video_bytes, video_uploaded_at, ${CAPTURE_COLUMNS}`)
      .eq('id', row.bet_id)
      .maybeSingle()
    const bet = (betRaw ?? undefined) as BetDetailRow | undefined

    // Re-evaluate the risk rules every time a reviewer opens the claim, so
    // what they see reflects everything that has happened since submission.
    const risk = bet ? await tryRefreshClaimRisk(admin, bet.id) : null

    const [historyRes, profileRes, eventsRes, witnesses] = await Promise.all([
      bet ? admin.from('bets').select(BET_SELECT).eq('user_id', bet.user_id).order('created_at', { ascending: false }).limit(5) : Promise.resolve({ data: [] as BetRowLike[] }),
      bet ? admin.from('profiles').select('total_attempts').eq('id', bet.user_id).maybeSingle() : Promise.resolve({ data: null }),
      admin.from('claim_events').select('id, table_name, action, actor_id, actor_role, changed, created_at').eq('bet_id', row.bet_id).order('created_at', { ascending: true }).limit(200),
      witnessesForBet(admin, row.bet_id),
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
      capture: captureOf(bet),
      certificateSeal: { sha256: row.certificate_sha256 ?? null, bytes: row.certificate_bytes ?? null },
      affidavitSeal: { sha256: row.affidavit_sha256 ?? null, bytes: row.affidavit_bytes ?? null },
      witnesses: witnesses.map(w => ({ id: w.id, role: w.role, name: w.name, email: w.email, createdAt: w.created_at })),
      riskScore: risk?.score ?? 0,
      riskFlags: risk?.flags ?? [],
      reviewChecklist: (row.review_checklist as Record<string, unknown> | null) ?? null,
      payoutReference: bet?.payout_reference ?? null,
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
  /** Required, all true, to approve. */
  checklist: z.record(z.string(), z.boolean()).optional(),
})

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { verificationId } = await params
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response

  // A decision carries its reason. Approval also carries what was checked.
  const notes = body.data.reviewerNotes ?? ''
  const isDecision = body.data.status === 'approved' || body.data.status === 'rejected'
  if (isDecision && notes.length < MIN_DECISION_NOTES) {
    return NextResponse.json({ error: `Say why, in at least ${MIN_DECISION_NOTES} characters. The reason is part of the record.`, code: 'NOTES_REQUIRED' }, { status: 400 })
  }
  let extra: Record<string, unknown> = {}
  if (body.data.status === 'approved') {
    const checklist = ChecklistSchema.safeParse(body.data.checklist ?? {})
    if (!checklist.success) {
      return NextResponse.json({ error: 'Every item on the review checklist must be confirmed before approving.', code: 'CHECKLIST_INCOMPLETE' }, { status: 400 })
    }
    extra = { review_checklist: { ...checklist.data, completed_by: auth.user.id, completed_at: new Date().toISOString() } }
  }

  try {
    const { betId } = await reviewVerification(auth.adminClient, {
      verificationId,
      to: body.data.status,
      actorId: auth.user.id,
      notes: body.data.reviewerNotes,
      extra,
    })
    log.info('admin.review', { admin_id: auth.user.id, verification_id: verificationId, bet_id: betId, status: body.data.status })
    return NextResponse.json({ success: true, verificationId, newStatus: body.data.status })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('admin.review_failed', err, { path: 'admin_review' })
  }
}
