import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { picksOpen } from '@/lib/fan-prize'
import { loadIconEvent, type IconEventRow } from './shared'

/**
 * GET /api/admin/icons/event — the event behind Back an Icon: when picks
 * close, whether the backer list is frozen and its hash, whether the draw
 * has run and who won.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  try {
    const event = await loadIconEvent(auth.adminClient)
    if (!event) return NextResponse.json({ error: 'No event is set up. Apply migration 036.', code: 'NO_EVENT' }, { status: 404 })

    const admin = auth.adminClient
    const [snapshot, eligible, winnersRes] = await Promise.all([
      admin.from('icon_vote_snapshot').select('user_id', { count: 'exact', head: true }).eq('event_id', event.id),
      admin.from('icon_vote_snapshot').select('user_id', { count: 'exact', head: true }).eq('event_id', event.id).eq('eligible', true),
      admin.from('fan_prize_winners').select('position, user_id, icon_id, email, draw_rank, created_at').eq('event_id', event.id).order('position'),
    ])
    if (snapshot.error) throw snapshot.error
    if (eligible.error) throw eligible.error
    if (winnersRes.error) throw winnersRes.error

    return NextResponse.json({
      data: present(event),
      snapshotCount: snapshot.count ?? 0,
      eligibleCount: eligible.count ?? 0,
      winners: winnersRes.data ?? [],
    })
  } catch (err) {
    return apiError('admin.icons.event_failed', err)
  }
}

const Patch = z.object({
  /** ISO timestamp, or null to leave picks open until the list is frozen by hand. */
  firstTeeAt: z.iso.datetime({ offset: true }).nullable(),
})

/**
 * PATCH /api/admin/icons/event — set first tee, the moment picks close.
 * Refused once the list is frozen: the cut-off is then on record.
 */
export async function PATCH(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const body = await parseBody(request, Patch)
  if (!body.ok) return body.response
  try {
    const event = await loadIconEvent(auth.adminClient)
    if (!event) return NextResponse.json({ error: 'No event is set up. Apply migration 036.', code: 'NO_EVENT' }, { status: 404 })
    if (event.frozen_at) {
      return NextResponse.json({ error: 'The backer list is frozen, so first tee is on record and cannot change.', code: 'EVENT_FROZEN' }, { status: 409 })
    }
    const { data, error } = await auth.adminClient
      .from('icon_events')
      .update({ first_tee_at: body.data.firstTeeAt })
      .eq('id', event.id)
      .is('frozen_at', null)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'The backer list was frozen just now.', code: 'EVENT_FROZEN' }, { status: 409 })
    log.info('admin.icons.event_updated', { id: event.id, by: auth.user.id, first_tee_at: body.data.firstTeeAt })
    return NextResponse.json({ data: present(data as IconEventRow) })
  } catch (err) {
    return apiError('admin.icons.event_update_failed', err)
  }
}

function present(event: IconEventRow) {
  return { ...event, picksOpen: picksOpen(event) }
}
