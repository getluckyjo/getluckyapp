/**
 * Account deletion (Batch 8, POPIA).
 *
 *   GET    /api/account   can this account go, and what would it forfeit
 *   DELETE /api/account   storage first, then the auth user; the ledger stays
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, USER_A, USER_B, COURSE_ID, HOLE_ID, type FakeClientOptions } from '../helpers/fake-supabase'
import { GET, DELETE } from '@/app/api/account/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb
const asUser = (user = USER_A) => serverClient.createClient.mockResolvedValue(createFakeClient(db, { user }))
const adminWith = (opts: FakeClientOptions = {}) => adminClient.createAdminClient.mockImplementation(() => createFakeClient(db, opts))
const bet = (user: string, over: Record<string, unknown> = {}) =>
  db.seed('bets', { user_id: user, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'active', ...over })[0]
const del = (ip = '1.2.3.4') => DELETE(new Request('http://x/api/account', { method: 'DELETE', headers: { 'x-forwarded-for': ip } }) as never)

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminWith()
  db.seed('profiles', { id: USER_A.id, name: 'Alice' }, { id: USER_B.id, name: 'Bob' })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('GET /api/account', () => {
  it('401 without a session', async () => {
    asUser(null as never)
    expect((await GET()).status).toBe(401)
  })

  it('a plain account can be deleted, and says what is forfeited', async () => {
    asUser()
    bet(USER_A.id); bet(USER_A.id); bet(USER_A.id, { status: 'miss' })
    const body = await (await GET()).json()
    expect(body).toMatchObject({ canDelete: true, reason: null, message: null, activeBets: 2 })
  })

  it('a suspended account is blocked', async () => {
    asUser()
    db.find('profiles', r => r.id === USER_A.id)!.suspended_at = '2026-09-01T00:00:00Z'
    const body = await (await GET()).json()
    expect(body).toMatchObject({ canDelete: false, reason: 'ACCOUNT_SUSPENDED' })
    expect(body.message).toMatch(/suspended/)
  })

  it.each(['verified', 'paid'])('a %s bet blocks deletion', async status => {
    asUser()
    bet(USER_A.id, { status })
    expect(await (await GET()).json()).toMatchObject({ canDelete: false, reason: 'CLAIM_OPEN' })
  })

  it.each(['documents_received', 'under_review', 'approved'])('a claim that is %s blocks deletion', async status => {
    asUser()
    const b = bet(USER_A.id, { status: 'claimed' })
    db.seed('verifications', { bet_id: b.id, status })
    expect(await (await GET()).json()).toMatchObject({ canDelete: false, reason: 'CLAIM_OPEN' })
  })

  it.each(['rejected', 'pending'])('a claim that is %s does not block', async status => {
    asUser()
    const b = bet(USER_A.id, { status: 'claimed' })
    db.seed('verifications', { bet_id: b.id, status })
    expect(await (await GET()).json()).toMatchObject({ canDelete: true })
  })

  it('a declared win with no documents yet does not block (the claim is abandoned)', async () => {
    asUser()
    bet(USER_A.id, { status: 'claimed' })
    expect(await (await GET()).json()).toMatchObject({ canDelete: true })
  })

  it("another user's open claim is not this user's problem", async () => {
    asUser()
    bet(USER_B.id, { status: 'paid' })
    expect(await (await GET()).json()).toMatchObject({ canDelete: true })
  })
})

describe('DELETE /api/account', () => {
  it('401 without a session', async () => {
    asUser(null as never)
    expect((await del()).status).toBe(401)
    expect(db.deletedUsers).toEqual([])
  })

  it('removes the user, their rows and their objects; keeps the ledger and everyone else', async () => {
    asUser()
    const a1 = bet(USER_A.id, { status: 'miss', video_url: `${USER_A.id}/${'a1'}/shot.mp4` })
    const a2 = bet(USER_A.id, { status: 'claimed' })
    db.seed('verifications', { bet_id: a2.id, status: 'rejected', certificate_path: `${USER_A.id}/${a2.id}/cert/1-c.pdf` })
    const b1 = bet(USER_B.id, { status: 'active' })
    db.seed('payfast_payments', { m_payment_id: 'gl_a', user_id: USER_A.id, bet_id: a1.id, amount_cents: 5000, status: 'complete' })
    db.seed('payfast_payments', { m_payment_id: 'gl_b', user_id: USER_B.id, bet_id: b1.id, amount_cents: 5000, status: 'complete' })
    db.seed('claim_events', { bet_id: a1.id, table_name: 'bets', action: 'insert', actor_role: 'service_role', after: {} })
    db.putObject('shot-videos', `${USER_A.id}/a1/shot.mp4`)
    db.putObject('shot-videos', `${USER_A.id}/a2/shot.webm`)
    db.putObject('verification-docs', `${USER_A.id}/${a2.id}/cert/1-c.pdf`)
    db.putObject('verification-docs', `${USER_A.id}/${a2.id}/affidavit/2-a.pdf`)
    db.putObject('shot-videos', `${USER_B.id}/b1/shot.mp4`)
    db.putObject('verification-docs', `${USER_B.id}/x/cert/c.pdf`)

    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, objectsRemoved: 4, bets: 2 })

    expect(db.deletedUsers).toEqual([USER_A.id])
    expect(db.rows('profiles').map(p => p.id)).toEqual([USER_B.id])
    expect(db.rows('bets').map(b => b.user_id)).toEqual([USER_B.id])
    expect(db.rows('verifications')).toEqual([])
    expect(db.objectPaths('shot-videos')).toEqual([`${USER_B.id}/b1/shot.mp4`])
    expect(db.objectPaths('verification-docs')).toEqual([`${USER_B.id}/x/cert/c.pdf`])

    // The ledger keeps the money and loses the person; the audit log is untouched.
    const ledger = db.rows('payfast_payments').sort((x, y) => String(x.m_payment_id).localeCompare(String(y.m_payment_id)))
    expect(ledger.map(p => [p.m_payment_id, p.user_id, p.bet_id, p.amount_cents])).toEqual([
      ['gl_a', null, null, 5000],
      ['gl_b', USER_B.id, b1.id, 5000],
    ])
    expect(db.rows('claim_events')).toHaveLength(1)
  })

  it('409 and nothing removed when a claim is open', async () => {
    asUser()
    const b = bet(USER_A.id, { status: 'claimed' })
    db.seed('verifications', { bet_id: b.id, status: 'under_review' })
    db.putObject('shot-videos', `${USER_A.id}/${b.id}/shot.mp4`)
    const res = await del()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'CLAIM_OPEN' })
    expect(db.deletedUsers).toEqual([])
    expect(db.objectPaths('shot-videos')).toHaveLength(1)
  })

  it('409 when suspended', async () => {
    asUser()
    db.find('profiles', r => r.id === USER_A.id)!.suspended_at = '2026-09-01T00:00:00Z'
    const res = await del()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'ACCOUNT_SUSPENDED' })
    expect(db.deletedUsers).toEqual([])
  })

  it('500 and the account kept when storage cannot be cleared', async () => {
    asUser()
    adminWith({ storageRemoveError: 'storage down' })
    db.putObject('shot-videos', `${USER_A.id}/x/shot.mp4`)
    const res = await del()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: 'INTERNAL' })
    expect(db.deletedUsers).toEqual([])
    expect(db.rows('profiles').some(p => p.id === USER_A.id)).toBe(true)
  })

  it('500 when the auth user cannot be deleted', async () => {
    asUser()
    adminWith({ deleteUserError: 'auth down' })
    expect((await del()).status).toBe(500)
    expect(db.rows('profiles').some(p => p.id === USER_A.id)).toBe(true)
  })

  it('is rate limited per user', async () => {
    asUser()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await del()).status)
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  })
})
