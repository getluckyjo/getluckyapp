/**
 * GET /api/winners — the public list behind the leaderboard. Only paid-out
 * prizes, only "First L.", nothing else about the player.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, USER_A, USER_B, COURSE_ID } from '../helpers/fake-supabase'
import { GET, anonymise } from '@/app/api/winners/route'

const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb
beforeEach(() => {
  db = new FakeDb()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('anonymise', () => {
  it('reduces a full name to first name and last initial', () => {
    expect(anonymise('Thabo Mokoena')).toEqual({ display: 'Thabo M.', initials: 'TM' })
    expect(anonymise('Anna-Marie van der Merwe')).toEqual({ display: 'Anna-Marie M.', initials: 'AM' })
    expect(anonymise('Cher')).toEqual({ display: 'Cher', initials: 'C' })
    expect(anonymise(null)).toEqual({ display: 'A golfer', initials: 'GL' })
    expect(anonymise('   ')).toEqual({ display: 'A golfer', initials: 'GL' })
  })
})

describe('GET /api/winners', () => {
  it('lists only paid bets, anonymised, with the paid total', async () => {
    db.seed('profiles', { id: USER_A.id, name: 'Thabo Mokoena' }, { id: USER_B.id, name: 'Sarah Reyneke' })
    db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek' })
    db.seed('bets',
      { user_id: USER_A.id, course_id: COURSE_ID, status: 'paid', potential_win_pence: 50_000_000, stake_pence: 50_000, updated_at: '2026-09-01T00:00:00Z' },
      { user_id: USER_B.id, course_id: COURSE_ID, status: 'paid', potential_win_pence: 2_500_000, stake_pence: 5_000, updated_at: '2026-09-10T00:00:00Z' },
      { user_id: USER_B.id, course_id: COURSE_ID, status: 'verified', potential_win_pence: 100_000_000, stake_pence: 100_000 },
      { user_id: USER_A.id, course_id: COURSE_ID, status: 'claimed', potential_win_pence: 100_000_000, stake_pence: 100_000 },
      { user_id: USER_A.id, course_id: COURSE_ID, status: 'miss', potential_win_pence: 100_000_000, stake_pence: 100_000 },
    )

    const res = await GET()
    const body = await res.json()
    expect(res.headers.get('cache-control')).toContain('public')
    expect(body.totalPaidOutCents).toBe(52_500_000)
    expect(body.winners).toHaveLength(2)
    expect(body.winners[0]).toMatchObject({ name: 'Thabo M.', initials: 'TM', amountCents: 50_000_000, course: 'Leopard Creek', paidAt: '2026-09-01T00:00:00Z' })
    expect(body.winners[1].name).toBe('Sarah R.')
    for (const w of body.winners) {
      expect(w).not.toHaveProperty('userId')
      expect(w).not.toHaveProperty('user_id')
      expect(JSON.stringify(w)).not.toContain(USER_A.id)
    }
  })

  it('returns an empty, still-cacheable list when nothing has been paid (and when the DB fails)', async () => {
    const empty = await (await GET()).json()
    expect(empty).toEqual({ winners: [], totalPaidOutCents: 0 })

    adminClient.createAdminClient.mockImplementation(() => { throw new Error('down') })
    const failed = await GET()
    expect(failed.status).toBe(200)
    expect(await failed.json()).toEqual({ winners: [], totalPaidOutCents: 0 })
  })
})
