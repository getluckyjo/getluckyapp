import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'
import { assertOpen, claimErrorResponse } from '@/lib/claims/state-machine'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { CaptureSchema, captureColumns } from '@/lib/claims/capture'

const Body = z.object({
  betId: uuid,
  mimeType: z.string().max(100).default('video/webm'),
  /** What the recorder reported: timestamps, duration, position. Optional; stored for the reviewer. */
  capture: CaptureSchema.optional(),
})

/**
 * POST /api/videos/upload-url
 * Body: { betId, mimeType? }
 *
 * Issues a one-shot signed upload slot for the footage of an active,
 * in-window bet the caller owns. The server chooses the object path and
 * records it on the bet as `video_url` before the upload starts; the client
 * never supplies a path. After the upload the client calls
 * /api/videos/uploaded so the server can hash what actually landed.
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

    assertOpen(bet)

    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
    const storagePath = `${user.id}/${betId}/shot.${ext}`

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
    const attestation = bet.video_sha256
      ? {}
      : captureColumns(capture, { course: course ?? null, userAgent: request.headers.get('user-agent') })

    const { error: linkErr } = await createAdminClient()
      .from('bets')
      .update({ video_url: storagePath, updated_by: user.id, ...attestation })
      .eq('id', betId)
      .eq('user_id', user.id)
    if (linkErr) {
      log.error('claim.video_link_failed', linkErr, { path: 'claim', user_id: user.id, bet_id: betId })
      return NextResponse.json({ error: 'Could not prepare upload' }, { status: 500 })
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
