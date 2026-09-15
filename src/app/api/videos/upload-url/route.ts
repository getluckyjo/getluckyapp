import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'
import { assertOpen, claimErrorResponse } from '@/lib/claims/state-machine'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'

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
    const { betId, mimeType = 'video/webm' } = await request.json().catch(() => ({})) as { betId?: unknown; mimeType?: unknown }

    if (typeof betId !== 'string' || !betId) {
      return NextResponse.json({ error: 'betId required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const limited = await enforceRateLimit(RULES.upload, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited

    // Verify bet belongs to the current user (prevent IDOR)
    const { data: bet } = await supabase
      .from('bets')
      .select('id, status, expires_at')
      .eq('id', betId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!bet) {
      return NextResponse.json({ error: 'Bet not found or not yours' }, { status: 403 })
    }

    assertOpen(bet)

    const ext = typeof mimeType === 'string' && mimeType.includes('mp4') ? 'mp4' : 'webm'
    const storagePath = `${user.id}/${betId}/shot.${ext}`

    const { data, error } = await supabase.storage
      .from('shot-videos')
      .createSignedUploadUrl(storagePath)

    if (error) {
      log.error('claim.upload_url_failed', error, { path: 'claim', user_id: user.id, bet_id: betId })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { error: linkErr } = await createAdminClient()
      .from('bets')
      .update({ video_url: storagePath, updated_by: user.id })
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
    log.error('claim.upload_url_unhandled', err, { path: 'claim' })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
