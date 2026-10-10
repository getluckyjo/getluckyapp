/**
 * The fan prize: picks close at first tee or when the list is frozen, the
 * frozen list is hashed the same way whatever order it arrives in, the
 * draw is deterministic from the seed and excludes the ineligible, each
 * step runs once, and an Icon with picks cannot be deleted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B } from '../helpers/fake-supabase'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

import { drawHash, drawRank, drawWinners, ineligibleReason, picksOpen, snapshotHash, snapshotLines } from '@/lib/fan-prize'
import { GET as listIcons } from '@/app/api/icons/route'
import { POST as vote } from '@/app/api/icons/vote/route'
import { GET as eventGet, PATCH as eventPatch } from '@/app/api/admin/icons/event/route'
import { POST as freeze } from '@/app/api/admin/icons/event/freeze/route'
import { POST as draw } from '@/app/api/admin/icons/event/draw/route'
import { GET as record } from '@/app/api/admin/icons/event/record/route'
import { DELETE as adminDelete } from '@/app/api/admin/icons/[iconId]/route'

const ICON_A = '55555555-5555-4555-8555-555555555555'
const ICON_B = '66666666-6666-4666-8666-666666666666'
const EVENT = '99999999-9999-4999-8999-999999999999'
const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.com' }
const u = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

let db: FakeDb
const asUser = (user: { id: string; email?: string } | null) => serverClient.createClient.mockResolvedValue(createFakeClient(db, user ? { user } : {}))
const asAdmin = () => {
  db.seed('profiles', { id: ADMIN.id, name: 'Seed Admin', is_admin: true, email: ADMIN.email, age_verified_at: '2026-01-01T00:00:00Z' })
  asUser(ADMIN)
}
const params = (iconId: string) => ({ params: Promise.resolve({ iconId }) })
const post = (url: string, body: unknown) => jsonRequest(url, body)
const future = new Date(Date.now() + 86_400_000).toISOString()
const past = new Date(Date.now() - 60_000).toISOString()

beforeEach(() => {
  db = new FakeDb()
  db.seed('icons',
    { id: ICON_A, name: 'Ernie Els', team: 'rsa', is_captain: true, sort_order: 1, is_active: true },
    { id: ICON_B, name: 'John Terry', team: 'world', is_captain: false, sort_order: 2, is_active: true },
  )
  db.seed('icon_events', { id: EVENT, slug: 'icons-cup-sa-2026', name: 'Icons Cup South Africa', first_tee_at: future, winners_count: 3, frozen_at: null, snapshot_sha256: null, snapshot_count: null, winning_icon_id: null, draw_seed: null, draw_sha256: null, drawn_at: null, created_at: '2026-10-10T00:00:00Z' })
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('the pure rules', () => {
  it('picks are open until first tee, and closed once frozen whatever the clock says', () => {
    expect(picksOpen(null)).toBe(true)
    expect(picksOpen({ first_tee_at: null, frozen_at: null })).toBe(true)
    expect(picksOpen({ first_tee_at: future, frozen_at: null })).toBe(true)
    expect(picksOpen({ first_tee_at: past, frozen_at: null })).toBe(false)
    expect(picksOpen({ first_tee_at: future, frozen_at: past })).toBe(false)
    expect(picksOpen({ first_tee_at: '2026-12-11T05:00:00Z', frozen_at: null }, new Date('2026-12-11T05:00:00Z'))).toBe(false)
    expect(picksOpen({ first_tee_at: '2026-12-11T05:00:00Z', frozen_at: null }, new Date('2026-12-11T04:59:59Z'))).toBe(true)
  })

  it('hashes the backer list the same way in any order, and differently for any change', () => {
    const a = [{ userId: u(2), iconId: ICON_A }, { userId: u(1), iconId: ICON_B }]
    const b = [a[1], a[0]]
    expect(snapshotLines(a)).toEqual([`${u(1)}:${ICON_B}`, `${u(2)}:${ICON_A}`])
    expect(snapshotHash(a)).toBe(snapshotHash(b))
    expect(snapshotHash(a)).toBe(createHash('sha256').update(`${u(1)}:${ICON_B}\n${u(2)}:${ICON_A}`).digest('hex'))
    expect(snapshotHash([{ userId: u(2), iconId: ICON_B }, a[1]])).not.toBe(snapshotHash(a))
    expect(snapshotHash([])).toBe(createHash('sha256').update('').digest('hex'))
  })

  it('draws the same winners from the same seed, different ones from another, never a repeat', () => {
    const pool = [u(1), u(2), u(3), u(4), u(5), u(6)]
    const first = drawWinners('JSE ALSI close 11 Dec 2026: 98765.43', pool, 3)
    const again = drawWinners('JSE ALSI close 11 Dec 2026: 98765.43', [...pool].reverse(), 3)
    expect(first).toEqual(again)
    expect(first.map(w => w.position)).toEqual([1, 2, 3])
    expect(new Set(first.map(w => w.userId)).size).toBe(3)
    expect(first[0].rank).toBe(createHmac('sha256', 'JSE ALSI close 11 Dec 2026: 98765.43').update(first[0].userId).digest('hex'))
    expect(first[0].rank < first[1].rank && first[1].rank < first[2].rank).toBe(true)
    expect(drawWinners('a different seed', pool, 3)).not.toEqual(first)
    // Fewer backers than prizes: everyone wins once, nobody twice.
    expect(drawWinners('seed-seed', [u(1), u(1), u(2)], 3).map(w => w.userId).sort()).toEqual([u(1), u(2)])
    expect(drawWinners('seed-seed', [], 3)).toEqual([])
    expect(drawRank('k', 'm')).toHaveLength(64)
  })

  it('seals a draw over the snapshot hash, the Icon, the seed and the winners in order', () => {
    const winners = drawWinners('seed-seed', [u(1), u(2)], 2)
    const sealed = drawHash({ snapshotSha256: 'a'.repeat(64), winningIconId: ICON_A, seed: 'seed-seed', winners })
    const expected = createHash('sha256').update([`snapshot:${'a'.repeat(64)}`, `icon:${ICON_A}`, 'seed:seed-seed', ...winners.map(w => `${w.position}:${w.userId}:${w.rank}`)].join('\n')).digest('hex')
    expect(sealed).toBe(expected)
    expect(drawHash({ snapshotSha256: 'a'.repeat(64), winningIconId: ICON_B, seed: 'seed-seed', winners })).not.toBe(sealed)
  })

  it('knows who is out of the draw and why', () => {
    expect(ineligibleReason(null)).toBe('no_profile')
    expect(ineligibleReason({ age_verified_at: null, is_admin: false, suspended_at: null })).toBe('under_18')
    expect(ineligibleReason({ age_verified_at: '2026-01-01', is_admin: true, suspended_at: null })).toBe('staff')
    expect(ineligibleReason({ age_verified_at: '2026-01-01', is_admin: false, suspended_at: '2026-02-02' })).toBe('suspended')
    expect(ineligibleReason({ age_verified_at: '2026-01-01', is_admin: false, suspended_at: null })).toBeNull()
  })
})

describe('picks close', () => {
  it('a pick goes through before first tee and is refused after it, in the route and in the database', async () => {
    asUser(USER_A)
    expect((await vote(post('http://x/api/icons/vote', { iconId: ICON_A }))).status).toBe(200)

    db.find('icon_events', e => e.id === EVENT)!.first_tee_at = past
    const res = await vote(post('http://x/api/icons/vote', { iconId: ICON_B }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PICKS_CLOSED')
    expect(db.find('icon_votes', v => v.user_id === USER_A.id)?.icon_id).toBe(ICON_A)

    // The trigger alone, when the route's own check is bypassed by a stale read.
    db.find('icon_events', e => e.id === EVENT)!.first_tee_at = future
    db.find('icon_events', e => e.id === EVENT)!.frozen_at = past
    const frozen = await vote(post('http://x/api/icons/vote', { iconId: ICON_B }))
    expect(frozen.status).toBe(409)
  })

  it('the public route says whether picks are open and when they close, and counts through the view', async () => {
    asUser(null)
    db.seed('icon_votes', { user_id: u(1), icon_id: ICON_A }, { user_id: u(2), icon_id: ICON_A }, { user_id: u(3), icon_id: ICON_B })
    const json = await (await listIcons()).json()
    expect(json.picksOpen).toBe(true)
    expect(json.picksCloseAt).toBe(future)
    expect(json.icons.find((i: { id: string }) => i.id === ICON_A).votes).toBe(2)
    expect(json.totalVotes).toBe(3)

    db.find('icon_events', e => e.id === EVENT)!.frozen_at = past
    const closed = await (await listIcons()).json()
    expect(closed.picksOpen).toBe(false)
    expect(closed.picksCloseAt).toBe(past)
  })

  it('an admin can move first tee until the list is frozen', async () => {
    asAdmin()
    const moved = await eventPatch(jsonRequest('http://x/api/admin/icons/event', { firstTeeAt: '2026-12-11T06:30:00+02:00' }, { method: 'PATCH' }))
    expect(moved.status).toBe(200)
    expect(db.find('icon_events', e => e.id === EVENT)?.first_tee_at).toBe('2026-12-11T06:30:00+02:00')

    db.find('icon_events', e => e.id === EVENT)!.frozen_at = past
    const refused = await eventPatch(jsonRequest('http://x/api/admin/icons/event', { firstTeeAt: future }, { method: 'PATCH' }))
    expect(refused.status).toBe(409)
  })
})

describe('freeze and draw', () => {
  function seedBackers() {
    // Seven backers of Els: one under 18, one staff, one suspended, one with no profile; three eligible. Two back Terry.
    db.seed('profiles',
      { id: u(1), email: 'one@example.com', age_verified_at: '2026-01-01', is_admin: false, suspended_at: null },
      { id: u(2), email: 'two@example.com', age_verified_at: '2026-01-01', is_admin: false, suspended_at: null },
      { id: u(3), email: 'three@example.com', age_verified_at: '2026-01-01', is_admin: false, suspended_at: null },
      { id: u(4), email: 'minor@example.com', age_verified_at: null, is_admin: false, suspended_at: null },
      { id: u(5), email: 'staff@example.com', age_verified_at: '2026-01-01', is_admin: true, suspended_at: null },
      { id: u(6), email: 'banned@example.com', age_verified_at: '2026-01-01', is_admin: false, suspended_at: '2026-03-03' },
      { id: u(8), email: 'terry@example.com', age_verified_at: '2026-01-01', is_admin: false, suspended_at: null },
    )
    db.seed('icon_votes',
      ...[1, 2, 3, 4, 5, 6, 7].map(n => ({ user_id: u(n), icon_id: ICON_A, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z' })),
      { user_id: u(8), icon_id: ICON_B, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' },
      { user_id: u(9), icon_id: ICON_B, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' },
    )
  }

  it('freezes the list with eligibility and the hash, closes picks, and runs once', async () => {
    asAdmin()
    seedBackers()
    const res = await freeze()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.snapshotCount).toBe(9)
    expect(json.eligibleCount).toBe(4)
    const expectedHash = snapshotHash(db.rows('icon_votes').map(v => ({ userId: String(v.user_id), iconId: String(v.icon_id) })))
    expect(json.snapshotSha256).toBe(expectedHash)

    const event = db.find('icon_events', e => e.id === EVENT)!
    expect(event.frozen_at).toBeTruthy()
    expect(event.frozen_by).toBe(ADMIN.id)
    expect(event.snapshot_sha256).toBe(expectedHash)
    const snap = db.rows('icon_vote_snapshot')
    expect(snap).toHaveLength(9)
    expect(snap.find(r => r.user_id === u(4))).toMatchObject({ eligible: false, ineligible_reason: 'under_18' })
    expect(snap.find(r => r.user_id === u(5))).toMatchObject({ eligible: false, ineligible_reason: 'staff' })
    expect(snap.find(r => r.user_id === u(6))).toMatchObject({ eligible: false, ineligible_reason: 'suspended' })
    expect(snap.find(r => r.user_id === u(7))).toMatchObject({ eligible: false, ineligible_reason: 'no_profile', email: null })
    expect(snap.find(r => r.user_id === u(1))).toMatchObject({ eligible: true, email: 'one@example.com', picked_at: '2026-11-02T00:00:00Z' })

    // Picks are closed now, even though first tee is tomorrow.
    asUser(USER_B)
    expect((await vote(post('http://x/api/icons/vote', { iconId: ICON_B }))).status).toBe(409)

    // A second freeze is refused with the hash already on record.
    asAdmin()
    const again = await freeze()
    expect(again.status).toBe(409)
    expect((await again.json()).snapshotSha256).toBe(expectedHash)
    expect(db.rows('icon_vote_snapshot')).toHaveLength(9)
  })

  it('draws only among eligible backers of the winning Icon, reproducibly, once', async () => {
    asAdmin()
    seedBackers()
    expect((await draw(post('http://x/api/admin/icons/event/draw', { winningIconId: ICON_A, seed: 'JSE ALSI close 11 Dec 2026: 98765.43' }))).status).toBe(409)   // not frozen
    await freeze()

    const short = await draw(post('http://x/api/admin/icons/event/draw', { winningIconId: ICON_A, seed: 'short' }))
    expect(short.status).toBe(400)

    const res = await draw(post('http://x/api/admin/icons/event/draw', { winningIconId: ICON_A, seed: 'JSE ALSI close 11 Dec 2026: 98765.43' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.eligibleCount).toBe(3)
    expect(json.winners).toHaveLength(3)
    const expected = drawWinners('JSE ALSI close 11 Dec 2026: 98765.43', [u(1), u(2), u(3)], 3)
    expect(json.winners.map((w: { userId: string }) => w.userId)).toEqual(expected.map(w => w.userId))
    expect(json.winners.every((w: { userId: string }) => [u(1), u(2), u(3)].includes(w.userId))).toBe(true)
    expect(json.winners[0].email).toBeTruthy()

    const event = db.find('icon_events', e => e.id === EVENT)!
    expect(event.drawn_at).toBeTruthy()
    expect(event.winning_icon_id).toBe(ICON_A)
    expect(event.draw_seed).toBe('JSE ALSI close 11 Dec 2026: 98765.43')
    expect(event.draw_sha256).toBe(drawHash({ snapshotSha256: String(event.snapshot_sha256), winningIconId: ICON_A, seed: 'JSE ALSI close 11 Dec 2026: 98765.43', winners: expected }))
    expect(db.rows('fan_prize_winners').map(w => w.position)).toEqual([1, 2, 3])

    const again = await draw(post('http://x/api/admin/icons/event/draw', { winningIconId: ICON_B, seed: 'JSE ALSI close 11 Dec 2026: 98765.43' }))
    expect(again.status).toBe(409)
    expect((await again.json()).code).toBe('ALREADY_DRAWN')
  })

  it('says so when nobody eligible backed the Icon', async () => {
    asAdmin()
    db.seed('profiles', { id: u(5), email: 'staff@example.com', age_verified_at: '2026-01-01', is_admin: true, suspended_at: null })
    db.seed('icon_votes', { user_id: u(5), icon_id: ICON_B, created_at: past, updated_at: past })
    await freeze()
    const res = await draw(post('http://x/api/admin/icons/event/draw', { winningIconId: ICON_B, seed: 'JSE ALSI close 11 Dec 2026: 98765.43' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('NO_BACKERS')
    expect(db.find('icon_events', e => e.id === EVENT)?.drawn_at).toBeNull()
  })

  it('the record recomputes the hash from the stored list and carries the draw', async () => {
    asAdmin()
    seedBackers()
    expect((await record()).status).toBe(409)
    await freeze()
    await draw(post('http://x/api/admin/icons/event/draw', { winningIconId: ICON_A, seed: 'JSE ALSI close 11 Dec 2026: 98765.43' }))
    const res = await record()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('fan-prize-icons-cup-sa-2026.json')
    const json = JSON.parse(await res.text())
    expect(json.snapshot.matches).toBe(true)
    expect(json.snapshot.lines).toHaveLength(9)
    expect(json.snapshot.ineligible).toHaveLength(5)
    expect(json.draw.winners).toHaveLength(3)
    expect(JSON.stringify(json)).not.toContain('@example.com')

    const state = await (await eventGet()).json()
    expect(state.snapshotCount).toBe(9)
    expect(state.eligibleCount).toBe(4)
    expect(state.winners).toHaveLength(3)
    expect(state.data.picksOpen).toBe(false)
  })
})

describe('an Icon with picks stays on record', () => {
  it('refuses the delete and points at hiding', async () => {
    asAdmin()
    db.seed('icon_votes', { user_id: USER_B.id, icon_id: ICON_A })
    const res = await adminDelete(new Request('http://x/api/admin/icons/x', { method: 'DELETE' }), params(ICON_A))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ICON_BACKED')
    expect(db.find('icons', i => i.id === ICON_A)).toBeTruthy()

    const ok = await adminDelete(new Request('http://x/api/admin/icons/x', { method: 'DELETE' }), params(ICON_B))
    expect(ok.status).toBe(200)
  })
})
