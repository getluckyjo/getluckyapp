import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { drawHash, drawWinners } from '@/lib/fan-prize'
import { loadIconEvent } from '../shared'

const Body = z.object({
  winningIconId: uuid,
  /**
   * Something that could not have been known when the list was frozen and
   * that anyone can look up afterwards: the JSE All Share close on the day,
   * the evening's lottery numbers, a figure read out on air. Written to the
   * record as typed.
   */
  seed: z.string().trim().min(8, 'The seed needs at least 8 characters').max(200),
})

/**
 * POST /api/admin/icons/event/draw — draw the fan prize winners. Needs a
 * frozen list; runs once. The eligible backers of the winning Icon in the
 * snapshot are ranked by HMAC-SHA256(seed, user_id), lowest first, and the
 * first `winners_count` are written to fan_prize_winners with their rank.
 * The draw's own SHA-256 goes on the event, so the published record and the
 * database can be checked against each other.
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
    if (!event.frozen_at || !event.snapshot_sha256) {
      return NextResponse.json({ error: 'Freeze the backer list before drawing.', code: 'NOT_FROZEN' }, { status: 409 })
    }
    if (event.drawn_at) {
      return NextResponse.json({ error: 'The draw has already run.', code: 'ALREADY_DRAWN' }, { status: 409 })
    }

    const { data: icon, error: iconErr } = await admin.from('icons').select('id, name').eq('id', body.data.winningIconId).maybeSingle()
    if (iconErr) throw iconErr
    if (!icon) return NextResponse.json({ error: 'That Icon is not in the field', code: 'ICON_NOT_FOUND' }, { status: 404 })

    // The eligible backers of that Icon, from the frozen list only.
    const backers: { user_id: string; email: string | null }[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from('icon_vote_snapshot')
        .select('user_id, email')
        .eq('event_id', event.id)
        .eq('icon_id', icon.id)
        .eq('eligible', true)
        .order('user_id')
        .range(from, from + 999)
      if (error) throw error
      backers.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    if (backers.length === 0) {
      return NextResponse.json({ error: `Nobody eligible backed ${icon.name} in the frozen list, so there is no draw.`, code: 'NO_BACKERS' }, { status: 409 })
    }

    const winners = drawWinners(body.data.seed, backers.map(b => b.user_id), event.winners_count)
    const sha256 = drawHash({ snapshotSha256: event.snapshot_sha256, winningIconId: icon.id, seed: body.data.seed, winners })
    const emailOf = new Map(backers.map(b => [b.user_id, b.email]))

    const drawnAt = new Date().toISOString()
    // The event first: a second draw racing this one loses here and writes nothing.
    const { data: updated, error: updateErr } = await admin
      .from('icon_events')
      .update({ drawn_at: drawnAt, drawn_by: auth.user.id, winning_icon_id: icon.id, draw_seed: body.data.seed, draw_sha256: sha256 })
      .eq('id', event.id)
      .is('drawn_at', null)
      .select('id')
      .maybeSingle()
    if (updateErr) throw updateErr
    if (!updated) return NextResponse.json({ error: 'The draw was run by someone else just now.', code: 'ALREADY_DRAWN' }, { status: 409 })

    const { error: insertErr } = await admin.from('fan_prize_winners').insert(winners.map(w => ({
      event_id: event.id,
      position: w.position,
      user_id: w.userId,
      icon_id: icon.id,
      email: emailOf.get(w.userId) ?? null,
      draw_rank: w.rank,
    })))
    if (insertErr) throw insertErr

    log.info('admin.icons.drawn', { event_id: event.id, by: auth.user.id, icon_id: icon.id, eligible: backers.length, winners: winners.length, draw_sha256: sha256 })
    return NextResponse.json({
      ok: true,
      drawnAt,
      winningIcon: icon,
      eligibleCount: backers.length,
      drawSha256: sha256,
      winners: winners.map(w => ({ position: w.position, userId: w.userId, email: emailOf.get(w.userId) ?? null, rank: w.rank })),
    })
  } catch (err) {
    return apiError('admin.icons.draw_failed', err)
  }
}
