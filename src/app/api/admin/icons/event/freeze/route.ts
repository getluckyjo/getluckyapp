import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { loadIconEvent, rpcRefusal } from '../shared'

const Body = z.object({
  /**
   * Which public value will be the seed, committed now and published with
   * the hash: "JSE All Share index close on Fri 11 Dec 2026 as published
   * on jse.co.za, written as the number with two decimals". The draw
   * cannot check it; publishing it before the shot is what makes a chosen
   * seed visible to anyone who looks.
   */
  seedSource: z.string().trim().min(8, 'Say which public value will be the seed (at least 8 characters)').max(300),
})

/**
 * POST /api/admin/icons/event/freeze — close picks and freeze the backer
 * list, in one database transaction (`freeze_icon_event`, migration 043):
 * every icon_votes row is copied to icon_vote_snapshot with the golfer's
 * email and eligibility as of now, the hash over "event:<id>" and the
 * sorted "user_id:icon_id:eligibility" lines is written to the event with
 * the committed seed source, and from this moment the database refuses
 * any new or changed pick. Either all of it happens or none of it does.
 *
 * Once. A second call is a 409 with the hash already on record.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response
  const admin = auth.adminClient
  try {
    const event = await loadIconEvent(admin)
    if (!event) return NextResponse.json({ error: 'No event is set up. Apply migration 036.', code: 'NO_EVENT' }, { status: 404 })
    if (event.frozen_at) {
      return NextResponse.json({ error: 'The backer list is already frozen.', code: 'ALREADY_FROZEN', snapshotSha256: event.snapshot_sha256 }, { status: 409 })
    }

    const { data, error } = await admin.rpc('freeze_icon_event', { p_event_id: event.id, p_actor_id: auth.user.id, p_seed_source: body.data.seedSource })
    if (error) {
      const refusal = rpcRefusal(error)
      if (refusal?.code === 'ALREADY_FROZEN') {
        // Two admins pressed Freeze together; the other one's snapshot stands.
        return NextResponse.json({ error: refusal.hint, code: 'ALREADY_FROZEN', snapshotSha256: refusal.detail }, { status: 409 })
      }
      if (refusal) return NextResponse.json({ error: refusal.hint, code: refusal.code }, { status: refusal.code === 'NO_EVENT' ? 404 : 409 })
      throw error
    }
    const result = data as { frozen_at: string; snapshot_sha256: string; snapshot_count: number; eligible_count: number }

    log.info('admin.icons.frozen', { event_id: event.id, by: auth.user.id, backers: result.snapshot_count, eligible: result.eligible_count, snapshot_sha256: result.snapshot_sha256, seed_source: body.data.seedSource })
    return NextResponse.json({
      ok: true,
      frozenAt: result.frozen_at,
      snapshotSha256: result.snapshot_sha256,
      snapshotCount: result.snapshot_count,
      eligibleCount: result.eligible_count,
      seedSource: body.data.seedSource,
    })
  } catch (err) {
    return apiError('admin.icons.freeze_failed', err)
  }
}
