import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { ineligibleReason, snapshotHash, type EligibilityProfile } from '@/lib/fan-prize'
import { loadIconEvent } from '../shared'

/** How many rows go to PostgREST per insert; the backer list can be tens of thousands. */
const CHUNK = 500

/**
 * POST /api/admin/icons/event/freeze — close picks and freeze the backer
 * list. Every icon_votes row is copied to icon_vote_snapshot with the
 * golfer's email and eligibility as of now, the SHA-256 of the sorted
 * "user_id:icon_id" lines is written to the event, and from this moment
 * the database refuses any new or changed pick (migration 036).
 *
 * Once. A second call is a 409 with the hash already on record: the list
 * cannot be re-frozen, because the hash is the thing published before the
 * shot is played.
 */
export async function POST() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const admin = auth.adminClient
  try {
    const event = await loadIconEvent(admin)
    if (!event) return NextResponse.json({ error: 'No event is set up. Apply migration 036.', code: 'NO_EVENT' }, { status: 404 })
    if (event.frozen_at) {
      return NextResponse.json({ error: 'The backer list is already frozen.', code: 'ALREADY_FROZEN', snapshotSha256: event.snapshot_sha256 }, { status: 409 })
    }

    // Everyone who has picked. Paged: PostgREST answers at most 1,000 rows a
    // call, and the list may be far longer than that by December.
    const votes: { user_id: string; icon_id: string; updated_at: string; created_at: string }[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from('icon_votes')
        .select('user_id, icon_id, updated_at, created_at')
        .order('user_id')
        .range(from, from + 999)
      if (error) throw error
      votes.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }

    // Eligibility and the email to reach a winner, in one read per 500 backers.
    const profiles = new Map<string, EligibilityProfile & { email: string | null }>()
    for (let i = 0; i < votes.length; i += CHUNK) {
      const ids = votes.slice(i, i + CHUNK).map(v => v.user_id)
      const { data, error } = await admin.from('profiles').select('id, email, age_verified_at, is_admin, suspended_at').in('id', ids)
      if (error) throw error
      for (const p of data ?? []) profiles.set(p.id, { email: p.email ?? null, age_verified_at: p.age_verified_at ?? null, is_admin: p.is_admin ?? false, suspended_at: p.suspended_at ?? null })
    }

    const rows = votes.map(v => {
      const profile = profiles.get(v.user_id) ?? null
      const reason = ineligibleReason(profile)
      return {
        event_id: event.id,
        user_id: v.user_id,
        icon_id: v.icon_id,
        email: profile?.email ?? null,
        eligible: reason === null,
        ineligible_reason: reason,
        picked_at: v.updated_at ?? v.created_at,
      }
    })
    const sha256 = snapshotHash(rows.map(r => ({ userId: r.user_id, iconId: r.icon_id })))

    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await admin.from('icon_vote_snapshot').insert(rows.slice(i, i + CHUNK))
      if (error) throw error
    }

    const frozenAt = new Date().toISOString()
    const { data: updated, error: updateErr } = await admin
      .from('icon_events')
      .update({ frozen_at: frozenAt, frozen_by: auth.user.id, snapshot_sha256: sha256, snapshot_count: rows.length })
      .eq('id', event.id)
      .is('frozen_at', null)
      .select('id')
      .maybeSingle()
    if (updateErr) throw updateErr
    if (!updated) {
      // Two admins pressed Freeze together; the other one's snapshot stands.
      return NextResponse.json({ error: 'The backer list was frozen by someone else just now.', code: 'ALREADY_FROZEN' }, { status: 409 })
    }

    const eligible = rows.filter(r => r.eligible).length
    log.info('admin.icons.frozen', { event_id: event.id, by: auth.user.id, backers: rows.length, eligible, snapshot_sha256: sha256 })
    return NextResponse.json({ ok: true, frozenAt, snapshotSha256: sha256, snapshotCount: rows.length, eligibleCount: eligible })
  } catch (err) {
    return apiError('admin.icons.freeze_failed', err)
  }
}
