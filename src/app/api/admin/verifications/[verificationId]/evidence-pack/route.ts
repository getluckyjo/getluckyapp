import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, uuid } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { witnessesForBet } from '@/lib/claims/witnesses'

type Params = { params: Promise<{ verificationId: string }> }

/**
 * GET — the evidence pack for one claim: everything the insurer would ask
 * for, in one JSON file. The response carries its own SHA-256 in a header
 * and in the admin UI, so the copy Indwe receives can be checked against
 * ours with `sha256sum`. Signed URLs inside it last 7 days.
 */
export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { verificationId } = await params
  if (!uuid.safeParse(verificationId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const admin = auth.adminClient

  try {
    // A read that fails is a 500, never a "Not found" the admin would believe.
    const { data: verification, error: vError } = await admin.from('verifications').select('*').eq('id', verificationId).maybeSingle()
    if (vError) throw vError
    if (!verification) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { data: bet, error: betError } = await admin.from('bets').select('*').eq('id', verification.bet_id).maybeSingle()
    if (betError) throw betError
    if (!bet) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [profile, course, hole, events, witnesses, payments] = await Promise.all([
      admin.from('profiles').select('id, name, email, created_at, total_attempts, suspended_at').eq('id', bet.user_id).maybeSingle(),
      admin.from('courses').select('id, name, location_text, region, lat, lng, is_partner').eq('id', bet.course_id).maybeSingle(),
      admin.from('holes').select('id, hole_number, par, distance_metres').eq('id', bet.hole_id).maybeSingle(),
      admin.from('claim_events').select('*').eq('bet_id', bet.id).order('created_at', { ascending: true }).limit(500),
      witnessesForBet(admin, bet.id),
      admin.from('payfast_payments').select('m_payment_id, pf_payment_id, tier, amount_cents, status, created_at').eq('bet_id', bet.id),
    ])

    const SEVEN_DAYS = 7 * 86_400
    const sign = async (bucket: string, path: string | null) => {
      if (!path) return null
      const { data } = await admin.storage.from(bucket).createSignedUrl(path, SEVEN_DAYS)
      return data?.signedUrl ?? null
    }
    const [videoUrl, certificateUrl, affidavitUrl] = await Promise.all([
      sign('shot-videos', bet.video_url), sign('verification-docs', verification.certificate_path), sign('verification-docs', verification.affidavit_path),
    ])

    const generatedAt = new Date().toISOString()
    const pack = {
      format: 'get-lucky-evidence-pack/1',
      generatedAt,
      generatedBy: auth.user.id,
      claim: { verification, bet },
      claimant: profile.data,
      course: course.data,
      hole: hole.data,
      payments: payments.data ?? [],
      objects: {
        footage: { path: bet.video_url, sha256: bet.video_sha256, bytes: bet.video_bytes, sealedAt: bet.video_uploaded_at, url: videoUrl },
        certificate: { path: verification.certificate_path, sha256: verification.certificate_sha256, bytes: verification.certificate_bytes, url: certificateUrl },
        affidavit: { path: verification.affidavit_path, sha256: verification.affidavit_sha256, bytes: verification.affidavit_bytes, url: affidavitUrl },
        urlsExpireAt: new Date(Date.now() + SEVEN_DAYS * 1000).toISOString(),
      },
      capture: {
        startedAt: bet.capture_started_at, endedAt: bet.capture_ended_at, durationMs: bet.capture_duration_ms,
        lat: bet.capture_lat, lng: bet.capture_lng, accuracyM: bet.capture_accuracy_m, distanceM: bet.capture_distance_m, userAgent: bet.capture_user_agent,
      },
      risk: { score: bet.risk_score, flags: bet.risk_flags, evaluatedAt: bet.risk_evaluated_at },
      witnesses: witnesses.map(w => ({
        role: w.role, source: w.source, name: w.name, email: w.email,
        requestedAt: w.requested_at, requestCount: w.request_count, respondedAt: w.responded_at, response: w.response, note: w.response_note,
      })),
      review: { checklist: verification.review_checklist, notes: verification.reviewer_notes, reviewedBy: verification.reviewed_by, verifiedAt: verification.verified_at, payoutInitiatedAt: verification.payout_initiated_at, payoutReference: bet.payout_reference },
      events: events.data ?? [],
    }

    const body = JSON.stringify(pack, null, 2)
    const sha256 = createHash('sha256').update(body).digest('hex')
    log.info('admin.evidence_pack_exported', { admin_id: auth.user.id, verification_id: verificationId, bet_id: bet.id, sha256 })

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="evidence-${bet.id}.json"`,
        'X-Evidence-Sha256': sha256,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return apiError('admin.evidence_pack_failed', err, { path: 'admin_review' })
  }
}
