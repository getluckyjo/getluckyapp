import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError } from '@/lib/api/http'
import { snapshotHash, snapshotLines, type Backer } from '@/lib/fan-prize'
import { loadIconEvent } from '../shared'

/**
 * GET /api/admin/icons/event/record — the verifiable record of the fan
 * prize, as a JSON file: the frozen backer list (user ids and Icon ids, no
 * names or emails), its hash, the seed, the winners and the draw hash.
 * Anyone with the file can recompute both hashes and re-run the draw with
 * the method described inside it. Send it to the insurer; publish the
 * hashes.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const admin = auth.adminClient
  try {
    const event = await loadIconEvent(admin)
    if (!event) return NextResponse.json({ error: 'No event is set up. Apply migration 036.', code: 'NO_EVENT' }, { status: 404 })
    if (!event.frozen_at) return NextResponse.json({ error: 'Nothing to record until the backer list is frozen.', code: 'NOT_FROZEN' }, { status: 409 })

    const snapshot: { user_id: string; icon_id: string; eligible: boolean; ineligible_reason: string | null }[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from('icon_vote_snapshot')
        .select('user_id, icon_id, eligible, ineligible_reason')
        .eq('event_id', event.id)
        .order('user_id')
        .range(from, from + 999)
      if (error) throw error
      snapshot.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    const [{ data: icons, error: iconsErr }, { data: winners, error: winnersErr }] = await Promise.all([
      admin.from('icons').select('id, name, team').order('name'),
      admin.from('fan_prize_winners').select('position, user_id, icon_id, draw_rank').eq('event_id', event.id).order('position'),
    ])
    if (iconsErr) throw iconsErr
    if (winnersErr) throw winnersErr

    const backers = snapshot.map(r => ({ userId: r.user_id, iconId: r.icon_id, eligible: r.eligible, ineligibleReason: r.ineligible_reason as Backer['ineligibleReason'] }))
    const recomputed = snapshotHash(event.id, backers)
    const record = {
      event: { id: event.id, slug: event.slug, name: event.name, firstTeeAt: event.first_tee_at, winnersCount: event.winners_count },
      method: {
        snapshotHash: 'SHA-256 over the line "event:<event id>" followed by one line per backer, "user_id:icon_id:eligibility" where eligibility is "eligible" or the reason (under_18, staff, suspended, no_profile), sorted by user_id in byte order, all joined by "\\n".',
        seed: 'The seed is the public value named in seedSource, committed when the list was frozen and published with the snapshot hash, typed in as observed. The draw was run by a different admin from the one who froze the list.',
        draw: 'Among eligible backers of the winning Icon, rank = HMAC-SHA256(key = seed, message = user_id) as lowercase hex; sort ascending by rank; the first winnersCount are the winners.',
        drawHash: 'SHA-256 over the lines "snapshot:<snapshotSha256>", "icon:<winningIconId>", "seed:<seed>", then "<position>:<user_id>:<rank>" per winner, joined by "\\n".',
      },
      snapshot: {
        frozenAt: event.frozen_at,
        count: event.snapshot_count,
        sha256: event.snapshot_sha256,
        recomputedSha256: recomputed,
        matches: recomputed === event.snapshot_sha256,
        seedSource: event.seed_source,
        lines: snapshotLines(event.id, backers),
        ineligible: snapshot.filter(r => !r.eligible).map(r => ({ userId: r.user_id, reason: r.ineligible_reason })),
      },
      icons: (icons ?? []).map(i => ({ id: i.id, name: i.name, team: i.team })),
      draw: event.drawn_at ? {
        drawnAt: event.drawn_at,
        winningIconId: event.winning_icon_id,
        seed: event.draw_seed,
        sha256: event.draw_sha256,
        winners: (winners ?? []).map(w => ({ position: w.position, userId: w.user_id, rank: w.draw_rank })),
      } : null,
      generatedAt: new Date().toISOString(),
    }
    return new NextResponse(JSON.stringify(record, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="fan-prize-${event.slug}.json"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return apiError('admin.icons.record_failed', err)
  }
}
