import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'
import { claimErrorResponse } from '@/lib/claims/state-machine'
import { assertFootageUploadable } from '@/lib/claims/footage-window'
import { randomUUID } from 'node:crypto'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { CaptureSchema, captureColumns } from '@/lib/claims/capture'

/** What the recorder produces and the bucket accepts (migration 042). Parameters such as `;codecs=vp9` are allowed and ignored. */
const MIME = /^video\/(mp4|webm)(;.*)?$/i

const Body = z.object({
  betId: uuid,
  mimeType: z.string().max(100).regex(MIME, 'Footage must be video/mp4 or video/webm').default('video/webm'),
  /** What the recorder reported: timestamps, duration, position. Optional; stored for the reviewer. */
  capture: CaptureSchema.optional(),
})

/**
 * POST /api/videos/upload-url
 * Body: { betId, mimeType? }
 *
 * Issues a one-shot signed upload slot for the footage of a bet the caller
 * owns that may still receive footage (active, a recorded miss or a claim,
 * inside the play window plus a grace period: src/lib/claims/footage-window.ts).
 * The server chooses the object path and records it on the bet as
 * `video_url` before the upload starts; the client never supplies a path.
 * After the upload the client calls /api/videos/uploaded so the server can
 * hash what actually landed.
 *
 * Every slot has its own object name (shot-<attempt>.<ext>). A retry after
 * a PUT whose answer was lost on a bad link gets a fresh name instead of a
 * "resource already exists" refusal on the old one, and needs no upsert
 * right on the bucket. The pointer on the bet moves to the newest slot
 * until the seal, which fixes it; the seal then removes the other attempts.
 */
export async function POST(request: NextRequest) {
  try {

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const limited = await enforceRateLimit(RULES.upload, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited
    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { betId, mimeType, capture } = body.data

    // Verify bet belongs to the current user (prevent IDOR)
    const { data: bet } = await supabase
      .from('bets')
      .select('id, status, expires_at, course_id, video_sha256')
      .eq('id', betId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!bet) {
      return NextResponse.json({ error: 'Bet not found or not yours' }, { status: 403 })
    }

    assertFootageUploadable(bet)

    // Sealed footage is final. The hash on the bet belongs to one object; a
    // second slot (say shot.webm after shot.mp4) would let the pointer move
    // to footage the hash never covered.
    if (bet.video_sha256) {
      return NextResponse.json({ error: 'The footage for this bet is already recorded.', code: 'FOOTAGE_SEALED' }, { status: 409 })
    }

    const ext = mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm'
    const storagePath = `${user.id}/${betId}/shot-${randomUUID().slice(0, 8)}.${ext}`

    const { data, error } = await supabase.storage
      .from('shot-videos')
      .createSignedUploadUrl(storagePath)

    if (error) {
      return apiError('claim.upload_url_failed', error, { path: 'claim', fields: { user_id: user.id, bet_id: betId }, message: 'Could not prepare the upload.' })
    }

    // The capture report is recorded once, with the first upload slot, and
    // never after the footage is sealed: the attestation belongs to the bytes
    // that were hashed, not to a later retry.
    const { data: course } = await supabase.from('courses').select('lat, lng').eq('id', bet.course_id).maybeSingle()
    const attestation = captureColumns(capture, { course: course ?? null, userAgent: request.headers.get('user-agent') })

    // Compare-and-set: a seal that landed between the read above and this
    // write wins, and the pointer stays on the hashed object.
    const { data: linked, error: linkErr } = await createAdminClient()
      .from('bets')
      .update({ video_url: storagePath, updated_by: user.id, ...attestation })
      .eq('id', betId)
      .eq('user_id', user.id)
      .is('video_sha256', null)
      .select('id')
      .maybeSingle()
    if (linkErr) {
      log.error('claim.video_link_failed', linkErr, { path: 'claim', user_id: user.id, bet_id: betId })
      return NextResponse.json({ error: 'Could not prepare upload' }, { status: 500 })
    }
    if (!linked) {
      return NextResponse.json({ error: 'The footage for this bet is already recorded.', code: 'FOOTAGE_SEALED' }, { status: 409 })
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      storagePath,
      source: 'supabase',
    })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('claim.upload_url_unhandled', err, { path: 'claim' })
  }
}
