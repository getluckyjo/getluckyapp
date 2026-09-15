import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { apiError, parseBody, uuid } from '@/lib/api/http'

const Body = z.object({ betId: uuid })

/**
 * POST /api/videos/uploaded
 * Body: { betId }
 *
 * Called by the client once the signed-URL upload completes. The server
 * reads the object back from storage (service role), records its SHA-256,
 * size and the server's own timestamp on the bet. The path is the one the
 * server chose in /api/videos/upload-url; the client sends nothing but the
 * bet id. An admin can later re-hash the object to prove it is unchanged.
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
    const { betId } = body.data

    const { data: bet } = await supabase
      .from('bets')
      .select('id, video_url, video_sha256')
      .eq('id', betId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!bet) {
      return NextResponse.json({ error: 'Bet not found' }, { status: 404 })
    }
    if (!bet.video_url) {
      return NextResponse.json({ error: 'No upload was prepared for this bet' }, { status: 400 })
    }
    if (bet.video_sha256) {
      // Write-once: the first hash stands. A second upload cannot replace it.
      return NextResponse.json({ ok: true, sha256: bet.video_sha256, alreadyRecorded: true })
    }

    const admin = createAdminClient()
    const { data: blob, error: dlErr } = await admin.storage.from('shot-videos').download(bet.video_url as string)
    if (dlErr || !blob) {
      log.warn('claim.video_missing_after_upload', { user_id: user.id, bet_id: betId, path: bet.video_url, error: dlErr?.message })
      return NextResponse.json({ error: 'Footage not found in storage' }, { status: 404 })
    }

    const bytes = Buffer.from(await blob.arrayBuffer())
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    const { error } = await admin
      .from('bets')
      .update({ video_sha256: sha256, video_bytes: bytes.length, video_uploaded_at: new Date().toISOString(), updated_by: user.id })
      .eq('id', betId)
      .eq('user_id', user.id)
    if (error) {
      log.error('claim.video_hash_write_failed', error, { path: 'claim', user_id: user.id, bet_id: betId })
      return NextResponse.json({ error: 'Could not record footage' }, { status: 500 })
    }

    log.info('claim.video_recorded', { user_id: user.id, bet_id: betId, sha256, bytes: bytes.length })
    return NextResponse.json({ ok: true, sha256, bytes: bytes.length })
  } catch (err) {
    return apiError('claim.video_uploaded_unhandled', err, { path: 'claim' })
  }
}
