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
import type { CaptureAttestation, RiskFlag } from '@/types/admin'
import type { ReviewMedia, VerificationReview } from '../review-types'

type Params = { params: Promise<{ verificationId: string }> }

interface BetDetailRow extends BetRowLike {
  expires_at: string | null
  video_sha256: string | null
  video_bytes: number | null
  video_uploaded_at: string | null
  footage_purged_at: string | null
  risk_evaluated_at: string | null
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
const BET_DETAIL_SELECT = `${BET_SELECT}, expires_at, video_sha256, video_bytes, video_uploaded_at, footage_purged_at, risk_evaluated_at, ${CAPTURE_COLUMNS}`

/** Signed links last an hour: long enough to review, short enough not to leak. */
const LINK_SECONDS = 3600

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

type Admin = Extract<Awaited<ReturnType<typeof requireAdmin>>, { ok: true }>['adminClient']

/** The payment that bought the swing. A free swing has no stake and no payment. */
async function paymentFor(admin: Admin, bet: BetDetailRow | undefined): Promise<VerificationReview['payment']> {
  if (!bet || !(bet.stake_pence > 0)) return null
  // The bet's own reference is never rewritten; the ledger's bet_id link is best-effort.
  const q = admin.from('payfast_payments').select('m_payment_id, amount_cents, status')
  const { data, error } = bet.payment_intent_id
    ? await q.eq('m_payment_id', bet.payment_intent_id).maybeSingle()
    : await q.eq('bet_id', bet.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  const row = data as { m_payment_id: string; amount_cents: number; status: NonNullable<VerificationReview['payment']>['status'] } | null
  if (!row) return { status: 'missing', amountCents: null, reference: bet.payment_intent_id }
  return { status: row.status, amountCents: row.amount_cents, reference: row.m_payment_id }
}

/**
 * GET — one claim with everything the reviewer needs. The risk rules are
 * re-run each time the claim is opened, unless the request says `?fresh=0`
 * (a reload after an action, or for new links), when the stored result is
 * used. Everything that depends only on the claim and its bet runs at once.
 */
export async function GET(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { verificationId } = await params
  if (!uuid.safeParse(verificationId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const admin = auth.adminClient
  const recheck = new URL(request.url).searchParams.get('fresh') !== '0'

  try {
    const { data: rowRaw, error } = await admin.from('verifications').select('*').eq('id', verificationId).maybeSingle()
    if (error) throw error
    if (!rowRaw) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const row = rowRaw as VerificationRowLike

    const { data: betRaw, error: betError } = await admin.from('bets').select(BET_DETAIL_SELECT).eq('id', row.bet_id).maybeSingle()
    if (betError) throw betError
    const bet = (betRaw ?? undefined) as BetDetailRow | undefined

    const unsignedMedia: ReviewMedia[] = []
    /** A signed link; null when there is no file; null and noted in unsignedMedia when the link could not be made. */
    const sign = async (media: ReviewMedia, bucket: string, path: string | null, download = false) => {
      if (!path) return null
      const { data, error: signError } = await admin.storage.from(bucket).createSignedUrl(path, LINK_SECONDS, download ? { download: true } : undefined)
      if (signError || !data?.signedUrl) {
        log.warn('admin.review_sign_failed', { verification_id: verificationId, media, error: signError?.message ?? 'no url' })
        if (!unsignedMedia.includes(media)) unsignedMedia.push(media)
        return null
      }
      return data.signedUrl
    }
    const noRow = Promise.resolve({ data: null, error: null })
    const signedAt = new Date().toISOString()

    const [risk, { history, names }, profileRes, holeRes, payment, eventsRes, witnesses, links] = await Promise.all([
      bet && recheck ? tryRefreshClaimRisk(admin, bet.id) : Promise.resolve(null),
      (async () => {
        const res = bet
          ? await admin.from('bets').select(BET_SELECT).eq('user_id', bet.user_id).order('created_at', { ascending: false }).limit(5)
          : { data: [] as BetRowLike[] }
        const list = (res.data ?? []) as BetRowLike[]
        return { history: list, names: await namesForBets(admin, bet ? [bet, ...list] : list) }
      })(),
      bet ? admin.from('profiles').select('email, total_attempts, suspended_at, suspended_reason, age_verified_at').eq('id', bet.user_id).maybeSingle() : noRow,
      bet ? admin.from('holes').select('par, distance_metres').eq('id', bet.hole_id).maybeSingle() : noRow,
      paymentFor(admin, bet),
      admin.from('claim_events').select('id, table_name, action, actor_id, actor_role, changed, created_at').eq('bet_id', row.bet_id).order('created_at', { ascending: true }).limit(200),
      witnessesForBet(admin, row.bet_id),
      Promise.all([
        sign('video', 'shot-videos', bet?.video_url ?? null),
        sign('certificate', 'verification-docs', row.certificate_path),
        sign('certificate', 'verification-docs', row.certificate_path, true),
        sign('affidavit', 'verification-docs', row.affidavit_path),
        sign('affidavit', 'verification-docs', row.affidavit_path, true),
      ]),
    ])
    const [videoSignedUrl, certificateSignedUrl, certificateDownloadUrl, affidavitSignedUrl, affidavitDownloadUrl] = links
    const profile = profileRes.data as { email: string | null; total_attempts: number | null; suspended_at: string | null; suspended_reason: string | null; age_verified_at: string | null } | null
    const hole = holeRes.data as { par: number | null; distance_metres: number | null } | null

    // When the rules could not run (or were skipped), the bet's stored result
    // stands, and the page says so: never a clean "no rules fired" by default.
    const storedFlags = Array.isArray(bet?.risk_flags) ? (bet.risk_flags as RiskFlag[]) : []
    const riskCheck: VerificationReview['riskCheck'] = risk ? 'fresh' : !bet || !recheck ? 'stored' : 'failed'

    const detail: VerificationReview = {
      ...toQueueItem(row, bet, names),
      videoSignedUrl,
      certificateSignedUrl,
      affidavitSignedUrl,
      certificateDownloadUrl,
      affidavitDownloadUrl,
      unsignedMedia,
      signedAt,
      footagePurgedAt: bet?.footage_purged_at ?? null,
      capture: captureOf(bet),
      certificateSeal: { sha256: row.certificate_sha256 ?? null, bytes: row.certificate_bytes ?? null },
      affidavitSeal: { sha256: row.affidavit_sha256 ?? null, bytes: row.affidavit_bytes ?? null },
      witnesses: witnesses.map(w => ({
        id: w.id, role: w.role, name: w.name, email: w.email, source: w.source ?? 'claimant',
        requestedAt: w.requested_at ?? null, requestCount: w.request_count ?? 0,
        respondedAt: w.responded_at ?? null, response: w.response ?? null, responseNote: w.response_note ?? null,
        linkExpired: !w.response && !!w.requested_at && (!w.token_expires_at || Date.parse(w.token_expires_at) < Date.now()),
        createdAt: w.created_at,
      })),
      riskScore: risk ? risk.score : bet?.risk_score ?? 0,
      riskFlags: risk ? risk.flags : storedFlags,
      riskCheck,
      riskEvaluatedAt: risk ? new Date().toISOString() : bet?.risk_evaluated_at ?? null,
      reviewChecklist: (row.review_checklist as Record<string, unknown> | null) ?? null,
      payoutReference: bet?.payout_reference ?? null,
      userBetHistory: history.map(b => toAdminBetRecord(b, names)),
      userTotalAttempts: profile?.total_attempts ?? 0,
      player: {
        email: profile?.email ?? null,
        suspendedAt: profile?.suspended_at ?? null,
        suspendedReason: profile?.suspended_reason ?? null,
        ageVerifiedAt: profile?.age_verified_at ?? null,
      },
      payment,
      hole: { par: hole?.par ?? null, distanceMetres: hole?.distance_metres ?? null },
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
