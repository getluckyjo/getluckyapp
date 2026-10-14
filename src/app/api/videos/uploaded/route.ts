import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { claimErrorResponse } from '@/lib/claims/state-machine'
import { assertFootageUploadable } from '@/lib/claims/footage-window'

const Body = z.object({ betId: uuid })

/** Reading a clip of up to 50 MB back from storage and hashing it can outlast the default. */
export const maxDuration = 60

/** The bucket's own cap (migration 042); the recorder makes clips of a few megabytes. */
export const MAX_FOOTAGE_BYTES = 50 * 1024 * 1024

/**
 * POST /api/videos/uploaded
 * Body: { betId }
 *
 * Called by the client once the signed-URL upload completes. The server
 * reads the object back from storage (service role), records its SHA-256,
 * size and the server's own timestamp on the bet. The path is the one the
 * server chose in /api/videos/upload-url; the client sends nothing but the
 * bet id. An admin can later re-hash the object to prove it is unchanged.
 *
 * The client calls this FIRST on every attempt, before asking for a slot:
 * when an earlier PUT landed but its answer was lost, this seals it without
 * another byte over the air. 404 FOOTAGE_MISSING means nothing is there yet
 * and the client should ask for a slot. Once sealed, the other attempts'
 * objects under the bet's folder are removed (best effort) and the claim,
 * if there is one, is stamped footage_received_at.
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
      .select('id, status, expires_at, video_url, video_sha256')
      .eq('id', betId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!bet) {
      return NextResponse.json({ error: 'Bet not found', code: 'BET_NOT_FOUND' }, { status: 404 })
    }
    if (bet.video_sha256) {
      // Write-once: the first hash stands. A second upload cannot replace it.
      return NextResponse.json({ ok: true, sha256: bet.video_sha256, alreadyRecorded: true })
    }
    if (!bet.video_url) {
      return NextResponse.json({ error: 'No upload was prepared for this bet', code: 'FOOTAGE_MISSING' }, { status: 404 })
    }
    assertFootageUploadable(bet)

    const admin = createAdminClient()
    const { data: blob, error: dlErr } = await admin.storage.from('shot-videos').download(bet.video_url as string)
    if (dlErr || !blob) {
      log.info('claim.video_not_landed', { user_id: user.id, bet_id: betId, path: bet.video_url, error: dlErr?.message })
      return NextResponse.json({ error: 'Footage not found in storage', code: 'FOOTAGE_MISSING' }, { status: 404 })
    }

    if (blob.size > MAX_FOOTAGE_BYTES) {
      log.warn('claim.video_too_large', { user_id: user.id, bet_id: betId, bytes: blob.size })
      return NextResponse.json({ error: 'Footage is too large to record', code: 'FOOTAGE_TOO_LARGE' }, { status: 413 })
    }

    // Hashed chunk by chunk from the blob's stream: no second copy of the
    // footage in memory beside the one the storage client returned.
    const hash = createHash('sha256')
    let bytes = 0
    for await (const chunk of blob.stream() as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk)
      bytes += chunk.byteLength
    }
    const sha256 = hash.digest('hex')

    // Write-once at the database too: the hash lands only if nothing sealed
    // the bet meanwhile and the pointer still names the object just hashed.
    const { data: sealed, error } = await admin
      .from('bets')
      .update({ video_sha256: sha256, video_bytes: bytes, video_uploaded_at: new Date().toISOString(), updated_by: user.id })
      .eq('id', betId)
      .eq('user_id', user.id)
      .eq('video_url', bet.video_url)
      .is('video_sha256', null)
      .select('video_sha256')
      .maybeSingle()
    if (error) {
      log.error('claim.video_hash_write_failed', error, { path: 'claim', user_id: user.id, bet_id: betId })
      return NextResponse.json({ error: 'Could not record footage' }, { status: 500 })
    }
    if (!sealed) {
      // A concurrent seal got there first; its hash is the record.
      const { data: now } = await admin.from('bets').select('video_sha256').eq('id', betId).maybeSingle()
      return NextResponse.json({ ok: true, sha256: now?.video_sha256 ?? null, alreadyRecorded: true })
    }

    log.info('claim.video_recorded', { user_id: user.id, bet_id: betId, sha256, bytes })

    // A claim made before the footage arrived is now complete on that count.
    const { error: stampErr } = await admin
      .from('verifications')
      .update({ footage_received_at: new Date().toISOString() })
      .eq('bet_id', betId)
      .is('footage_received_at', null)
    if (stampErr) log.warn('claim.footage_stamp_failed', { bet_id: betId, error: stampErr.message })

    // Earlier attempts that never sealed are dead weight; retention purges
    // by the sealed pointer only. Best effort, never a failure of the seal.
    const folder = (bet.video_url as string).split('/').slice(0, -1).join('/')
    await removeOtherAttempts(admin, folder, bet.video_url as string, betId)

    return NextResponse.json({ ok: true, sha256, bytes })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('claim.video_uploaded_unhandled', err, { path: 'claim' })
  }
}

async function removeOtherAttempts(admin: ReturnType<typeof createAdminClient>, folder: string, keep: string, betId: string): Promise<void> {
  try {
    const { data: entries, error } = await admin.storage.from('shot-videos').list(folder, { limit: 100 })
    if (error || !entries) return
    const others = entries
      .filter(e => e.id !== null && `${folder}/${e.name}` !== keep)
      .map(e => `${folder}/${e.name}`)
    if (others.length === 0) return
    const { error: rmErr } = await admin.storage.from('shot-videos').remove(others)
    if (rmErr) log.warn('claim.video_attempts_cleanup_failed', { bet_id: betId, count: others.length, error: rmErr.message })
    else log.info('claim.video_attempts_removed', { bet_id: betId, count: others.length })
  } catch (err) {
    log.warn('claim.video_attempts_cleanup_failed', { bet_id: betId, error: err instanceof Error ? err.message : String(err) })
  }
}
