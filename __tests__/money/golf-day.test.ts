/**
 * Golf days (migration 029): every player who joins through a golf day's
 * link gets its tab in place of Icons and one free swing on the day, on its
 * holes, for its prize.
 *
 * Invariants pinned here:
 *  - the day is South African time: the swing opens at 00:00 +02:00 on the
 *    date and closes 24 hours later, and joining closes with it
 *  - never more players than the day takes, even when the last place is raced
 *  - one swing per player, only for a joined player, only on the day's holes,
 *    only for the day's prize (the body cannot set it), never through the money path
 *  - the swing passes the same target check as every entry
 *  - only joined players see the tab; switching the day off takes it away
 *  - a signed-out visitor sees the day, not who or how many joined
 *  - admins make and change golf days, and only with holes that can be played
 *  - "Add to calendar" puts the day, the holes and the link in a player's
 *    calendar, as a well-formed .ics or a Google Calendar link
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, type FakeUser } from '../helpers/fake-supabase'
import { GET as readDay } from '@/app/api/golf-days/[slug]/route'
import { POST as joinDay } from '@/app/api/golf-days/[slug]/join/route'
import { POST as swingDay } from '@/app/api/golf-days/[slug]/swing/route'
import { GET as myTab } from '@/app/api/golf-days/route'
import { GET as listDays, POST as createDay } from '@/app/api/admin/golf-days/route'
import { PATCH as patchDay } from '@/app/api/admin/golf-days/[golfDayId]/route'
import { GET as listPlayers } from '@/app/api/admin/golf-days/[golfDayId]/players/route'
import { GET as dayCalendar } from '@/app/api/golf-days/[slug]/calendar/route'
import { golfDayEvent, googleCalendarUrl, toIcs, type CalendarDay } from '@/lib/golf-days/calendar'
import { siteUrl } from '@/lib/email/layout'
import {
  closesAt, formatGolfDayDate, golfDayPhase, golfDaySwingReference, opensAt, refusalFromDbError, shortCourseName, tabVisible, todayInSouthAfrica,
} from '@/lib/golf-days/rules'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

const USER_C: FakeUser = { id: '66666666-6666-4666-8666-666666666666', email: 'c@example.com' }
const ADMIN: FakeUser = { id: '99999999-9999-4999-8999-999999999999', email: 'admin@example.com' }
const EAST = 'e0000000-0000-4000-8000-00000000000e'
const WEST = 'e0000000-0000-4000-8000-00000000000f'
const ELSEWHERE = 'e0000000-0000-4000-8000-000000000010'
const EAST_2 = 'f0000000-0000-4000-8000-000000000002'
const EAST_12 = 'f0000000-0000-4000-8000-000000000012'
const EAST_1 = 'f0000000-0000-4000-8000-000000000001'
const EAST_5 = 'f0000000-0000-4000-8000-000000000005'
const WEST_17 = 'f0000000-0000-4000-8000-000000000017'
const ELSEWHERE_3 = 'f0000000-0000-4000-8000-000000000003'
const DAY = 24 * 3_600_000
let db: FakeDb

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const today = () => todayInSouthAfrica()

function asUser(user: FakeUser | null = USER_A) {
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user }))
}

function player(user: FakeUser = USER_A, over: Record<string, unknown> = {}) {
  db.seed('profiles', { id: user.id, name: `Player ${user.id.slice(0, 1)}`, email: user.email, age_verified_at: '2026-01-01T00:00:00Z', total_attempts: 0, ...over })
  asUser(user)
}

function asAdmin() {
  if (!db.find('profiles', p => p.id === ADMIN.id)) db.seed('profiles', { id: ADMIN.id, name: 'Admin', is_admin: true })
  asUser(ADMIN)
}

function seedCourses() {
  db.seed('courses',
    { id: EAST, name: 'Royal Johannesburg & Kensington – East', location_text: 'Linksfield, Gauteng', region: 'Gauteng', is_partner: true },
    { id: WEST, name: 'Royal Johannesburg & Kensington – West', location_text: 'Linksfield, Gauteng', region: 'Gauteng', is_partner: true },
    { id: ELSEWHERE, name: 'Closed Course', location_text: 'Somewhere', region: 'Gauteng', is_partner: false },
  )
  db.seed('holes',
    { id: EAST_2, course_id: EAST, hole_number: 2, par: 3, distance_metres: 211, is_active: true },
    { id: EAST_12, course_id: EAST, hole_number: 12, par: 3, distance_metres: 168, is_active: true },
    { id: EAST_1, course_id: EAST, hole_number: 1, par: 5, distance_metres: 463, is_active: true },
    { id: EAST_5, course_id: EAST, hole_number: 5, par: 3, distance_metres: 139, is_active: true },
    { id: WEST_17, course_id: WEST, hole_number: 17, par: 3, distance_metres: 185, is_active: true },
    { id: ELSEWHERE_3, course_id: ELSEWHERE, hole_number: 3, par: 3, distance_metres: 160, is_active: true },
  )
}

function seedDay(over: Record<string, unknown> = {}, holes: string[] = [EAST_2, WEST_17]) {
  const day = db.seed('golf_days', {
    slug: 'bombsquad', name: 'Bomb Squad Golf Day', tab_label: 'Bomb Squad', plays_on: today(),
    prize_pence: 10_000_000, max_players: 200, note: null, disabled_at: null, ...over,
  })[0]
  for (const hole_id of holes) db.seed('golf_day_holes', { golf_day_id: day.id, hole_id })
  return day
}

function joined(day: Record<string, unknown>, user: FakeUser = USER_A) {
  db.seed('golf_day_players', { golf_day_id: day.id, user_id: user.id, joined_at: new Date().toISOString() })
}

const slugParams = (slug = 'bombsquad') => ({ params: Promise.resolve({ slug }) })
const idParams = (golfDayId: string) => ({ params: Promise.resolve({ golfDayId }) })
const read = async (slug = 'bombsquad') => readDay(new Request(`http://x/api/golf-days/${slug}`), slugParams(slug))
const join = (slug = 'bombsquad') => joinDay(new Request(`http://x/api/golf-days/${slug}/join`, { method: 'POST' }), slugParams(slug))
const swing = (holeId: unknown = EAST_2, extra: Record<string, unknown> = {}, slug = 'bombsquad') =>
  swingDay(jsonRequest(`http://x/api/golf-days/${slug}/swing`, { holeId, ...extra }), slugParams(slug))
const swings = () => db.rows('bets').filter(b => b.tier === 'tier_golf_day')

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  seedCourses()
})
afterEach(() => vi.restoreAllMocks())

describe('the day, in South African time', () => {
  it('opens at midnight +02:00 on the date and closes 24 hours later', () => {
    expect(new Date(opensAt('2026-10-02')).toISOString()).toBe('2026-10-01T22:00:00.000Z')
    expect(new Date(closesAt('2026-10-02')).toISOString()).toBe('2026-10-02T22:00:00.000Z')
    expect(golfDayPhase('2026-10-02', Date.parse('2026-10-01T21:59:59Z'))).toBe('upcoming')
    expect(golfDayPhase('2026-10-02', Date.parse('2026-10-01T22:00:00Z'))).toBe('today')
    expect(golfDayPhase('2026-10-02', Date.parse('2026-10-02T21:59:59Z'))).toBe('today')
    expect(golfDayPhase('2026-10-02', Date.parse('2026-10-02T22:00:00Z'))).toBe('over')
  })

  it('keeps the tab for a week after the day, then gives Icons back', () => {
    expect(tabVisible('2026-10-02', Date.parse('2026-10-09T21:59:00Z'))).toBe(true)
    expect(tabVisible('2026-10-02', Date.parse('2026-10-09T22:00:00Z'))).toBe(false)
  })

  it('knows the South African date either side of midnight UTC', () => {
    expect(todayInSouthAfrica(Date.parse('2026-10-01T21:59:00Z'))).toBe('2026-10-01')
    expect(todayInSouthAfrica(Date.parse('2026-10-01T22:00:00Z'))).toBe('2026-10-02')
    expect(formatGolfDayDate('2026-10-02')).toBe('Friday 2 October')
  })

  it('reads the triggers\' refusals and nothing else, and names sibling courses briefly', () => {
    expect(refusalFromDbError({ code: 'P0001', message: 'GOLF_DAY_FULL' })).toBe('GOLF_DAY_FULL')
    expect(refusalFromDbError({ code: 'P0001', message: 'PROMO_CODE_EXHAUSTED' })).toBeNull()
    expect(refusalFromDbError({ code: '23505', message: 'GOLF_DAY_FULL' })).toBeNull()
    const both = ['Royal Johannesburg & Kensington – East', 'Royal Johannesburg & Kensington – West']
    expect(shortCourseName(both[0], both)).toBe('East')
    expect(shortCourseName(both[0], [both[0]])).toBe(both[0])
    expect(shortCourseName('Leopard Creek', both)).toBe('Leopard Creek')
  })
})

describe('GET /api/golf-days/[slug]', () => {
  it('404 for an unknown or malformed link', async () => {
    asUser(null); seedDay()
    expect((await read('nope')).status).toBe(404)
    expect((await read('BAD SLUG')).status).toBe(404)
  })

  it('shows a signed-out visitor the day, its prize and holes, and nothing about who joined', async () => {
    asUser(null); const day = seedDay(); joined(day, USER_B)
    const res = await read()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.me).toBeNull()
    expect(body.golfDay).toMatchObject({
      slug: 'bombsquad', name: 'Bomb Squad Golf Day', tabLabel: 'Bomb Squad', playsOn: today(),
      prizeZAR: 100000, phase: 'today', closed: false, full: false,
    })
    expect(body.golfDay.holes.map((h: { course: { name: string }; holeNumber: number; distanceMetres: number }) => [h.course.name.slice(-4), h.holeNumber, h.distanceMetres]))
      .toEqual([['East', 2, 211], ['West', 17, 185]])
    expect(JSON.stringify(body)).not.toContain(USER_B.id)
    expect(body.golfDay).not.toHaveProperty('maxPlayers')
  })

  it('tells a signed-in player whether they joined and where their swing stands', async () => {
    player(); const day = seedDay()
    expect((await (await read()).json()).me).toMatchObject({ joined: false, ageVerified: true, swing: null })
    joined(day)
    expect((await (await read()).json()).me).toMatchObject({ joined: true, swing: null })
    await swing()
    expect((await (await read()).json()).me.swing).toMatchObject({ status: 'active', holeId: EAST_2, open: true })
  })

  it('says full once every place is taken', async () => {
    asUser(null); const day = seedDay({ max_players: 1 }); joined(day, USER_B)
    expect((await (await read()).json()).golfDay.full).toBe(true)
  })
})

describe('POST join', () => {
  it('401 signed out, 404 for an unknown link', async () => {
    asUser(null); seedDay()
    expect((await join()).status).toBe(401)
    player()
    expect((await join('nope')).status).toBe(404)
  })

  it('joins, answers with the tab to show, and a second join is a no-op', async () => {
    player(); seedDay()
    const res = await join()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ joined: true, slug: 'bombsquad', tabLabel: 'Bomb Squad' })
    expect((await join()).status).toBe(200)
    expect(db.rows('golf_day_players')).toHaveLength(1)
  })

  it('joining before the day is fine; after it, or when switched off, is not', async () => {
    player(); seedDay({ slug: 'soon', plays_on: addDays(today(), 7) })
    expect((await join('soon')).status).toBe(200)
    seedDay({ slug: 'past', plays_on: addDays(today(), -1) })
    expect((await (await join('past')).json()).code).toBe('GOLF_DAY_OVER')
    seedDay({ slug: 'off', disabled_at: '2026-09-01T00:00:00Z' })
    expect((await (await join('off')).json()).code).toBe('GOLF_DAY_CLOSED')
  })

  it('stops at the cap', async () => {
    const day = seedDay({ max_players: 1 }); joined(day, USER_B)
    player()
    const res = await join()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('GOLF_DAY_FULL')
    expect(db.rows('golf_day_players')).toHaveLength(1)
  })

  it('a race for the last place is settled by the insert, not the check', async () => {
    const day = seedDay({ max_players: 1 })
    player()
    db.beforeInsert = table => {
      if (table !== 'golf_day_players') return
      db.beforeInsert = null
      joined(day, USER_B)
    }
    const res = await join()
    expect((await res.json()).code).toBe('GOLF_DAY_FULL')
    expect(db.rows('golf_day_players').map(p => p.user_id)).toEqual([USER_B.id])
  })

  it('a suspended player cannot join', async () => {
    player(USER_A, { suspended_at: '2026-09-01T00:00:00Z' }); seedDay()
    expect((await (await join()).json()).code).toBe('ACCOUNT_SUSPENDED')
  })
})

describe('POST swing', () => {
  it('401 signed out; 403 before the 18+ check; 403 before joining', async () => {
    const day = seedDay()
    asUser(null)
    expect((await swing()).status).toBe(401)
    player(USER_A, { age_verified_at: null }); joined(day)
    expect((await (await swing()).json()).code).toBe('AGE_NOT_VERIFIED')
    player(USER_B)
    const res = await swing()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('GOLF_DAY_NOT_JOINED')
    expect(swings()).toHaveLength(0)
  })

  it('only on the day, and not once the day is switched off', async () => {
    player()
    joined(seedDay({ slug: 'soon', plays_on: addDays(today(), 1) }))
    expect((await (await swing(EAST_2, {}, 'soon')).json()).code).toBe('GOLF_DAY_NOT_YET')
    joined(seedDay({ slug: 'past', plays_on: addDays(today(), -1) }))
    expect((await (await swing(EAST_2, {}, 'past')).json()).code).toBe('GOLF_DAY_OVER')
    joined(seedDay({ slug: 'off', disabled_at: '2026-09-01T00:00:00Z' }))
    expect((await (await swing(EAST_2, {}, 'off')).json()).code).toBe('GOLF_DAY_CLOSED')
    expect(swings()).toHaveLength(0)
  })

  it('only on the day\'s holes', async () => {
    player(); joined(seedDay())
    const res = await swing(EAST_12)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('GOLF_DAY_WRONG_HOLE')
    expect((await swing('not-a-uuid')).status).toBe(400)
    expect(swings()).toHaveLength(0)
  })

  it('grants an active bet for the day\'s prize, with no stake and no ledger row', async () => {
    player(); const day = seedDay(); joined(day)
    const before = Date.now()
    const res = await swing(WEST_17, { potential_win_pence: 1, prizeZAR: 1_000_000, stake_pence: 500 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      prizeZAR: 100000,
      course: { id: WEST, name: 'Royal Johannesburg & Kensington – West' },
      hole: { id: WEST_17, courseId: WEST, holeNumber: 17, par: 3, distanceMetres: 185 },
    })
    const bet = db.find('bets', b => b.id === body.betId)!
    expect(bet).toMatchObject({
      user_id: USER_A.id, course_id: WEST, hole_id: WEST_17, tier: 'tier_golf_day',
      stake_pence: 0, potential_win_pence: 10_000_000, golf_day_id: day.id, status: 'active',
      payment_intent_id: golfDaySwingReference(String(day.id), USER_A.id), updated_by: USER_A.id,
    })
    expect(Date.parse(bet.expires_at as string)).toBeGreaterThanOrEqual(before + DAY - 1000)
    expect(db.rows('payfast_payments')).toHaveLength(0)
    expect(db.find('profiles', p => p.id === USER_A.id)!.total_attempts).toBe(1)
  })

  it('one swing per player', async () => {
    player(); joined(seedDay())
    expect((await swing()).status).toBe(200)
    const res = await swing(WEST_17)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('GOLF_DAY_SWING_USED')
    expect(swings()).toHaveLength(1)
  })

  it('a double tap that slips past the check is caught by the unique reference', async () => {
    player(); const day = seedDay(); joined(day)
    db.beforeInsert = table => {
      if (table !== 'bets') return
      db.beforeInsert = null
      db.seed('bets', { user_id: USER_A.id, tier: 'tier_1', payment_intent_id: golfDaySwingReference(String(day.id), USER_A.id) })
    }
    expect((await (await swing()).json()).code).toBe('GOLF_DAY_SWING_USED')
    expect(swings()).toHaveLength(0)
  })

  it('the day switched off between the check and the insert is refused by the database', async () => {
    player(); const day = seedDay(); joined(day)
    db.beforeInsert = table => {
      if (table !== 'bets') return
      db.beforeInsert = null
      day.disabled_at = new Date().toISOString()
    }
    expect((await (await swing()).json()).code).toBe('GOLF_DAY_CLOSED')
    expect(swings()).toHaveLength(0)
  })

  it('passes the same target check as every entry', async () => {
    player(); joined(seedDay())
    db.find('holes', h => h.id === EAST_2)!.is_active = false
    const res = await swing(EAST_2)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('HOLE_INACTIVE')
  })

  it('is its own thing: the free swing and a promo swing are untouched by it', async () => {
    player(); joined(seedDay())
    db.seed('bets', { user_id: USER_A.id, tier: 'tier_free', payment_intent_id: `free_${USER_A.id}`, stake_pence: 0 })
    expect((await swing()).status).toBe(200)
    expect(db.rows('bets').map(b => b.tier).sort()).toEqual(['tier_free', 'tier_golf_day'])
  })
})

describe('GET /api/golf-days: the tab', () => {
  const tab = async () => (await (await myTab()).json()).tab

  it('nobody signed out, and nobody who did not join, sees it', async () => {
    asUser(null); const day = seedDay()
    expect(await tab()).toBeNull()
    player(USER_B)
    expect(await tab()).toBeNull()
    joined(day, USER_B)
    expect(await tab()).toEqual({ slug: 'bombsquad', tabLabel: 'Bomb Squad' })
  })

  it('goes when the day is switched off, and a week after the day', async () => {
    player()
    const off = seedDay({ slug: 'off', disabled_at: '2026-09-01T00:00:00Z' }); joined(off)
    const old = seedDay({ slug: 'old', plays_on: addDays(today(), -8) }); joined(old)
    expect(await tab()).toBeNull()
    const recent = seedDay({ slug: 'recent', tab_label: 'Recent', plays_on: addDays(today(), -3) }); joined(recent)
    expect(await tab()).toEqual({ slug: 'recent', tabLabel: 'Recent' })
  })

  it('with two, the sooner one', async () => {
    player()
    joined(seedDay({ slug: 'later', tab_label: 'Later', plays_on: addDays(today(), 20) }))
    joined(seedDay({ slug: 'sooner', tab_label: 'Sooner', plays_on: addDays(today(), 2) }))
    expect(await tab()).toEqual({ slug: 'sooner', tabLabel: 'Sooner' })
  })
})

describe('admin', () => {
  const create = (body: Record<string, unknown>) => createDay(jsonRequest('http://x/api/admin/golf-days', body))
  const patch = (id: string, body: Record<string, unknown>) => patchDay(jsonRequest('http://x', body, { method: 'PATCH' }), idParams(id))
  const valid = (over: Record<string, unknown> = {}) => ({
    slug: 'clubday', name: 'Club Day', tabLabel: 'Club Day', playsOn: addDays(today(), 10),
    prizeRand: 50000, maxPlayers: 120, holeIds: [EAST_12], ...over,
  })

  it('non-admins never reach the handlers', async () => {
    const day = seedDay(); player()
    expect((await listDays()).status).toBe(403)
    expect((await create(valid())).status).toBe(403)
    expect((await patch(String(day.id), { disabled: true })).status).toBe(403)
    expect((await listPlayers(new Request('http://x'), idParams(String(day.id)))).status).toBe(403)
    expect(db.find('golf_days', d => d.id === day.id)!.disabled_at).toBeNull()
  })

  it('creates a golf day with its holes and answers with its row', async () => {
    asAdmin()
    const res = await create(valid({ slug: ' ClubDay ', holeIds: [EAST_12, WEST_17] }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data).toMatchObject({ slug: 'clubday', name: 'Club Day', tabLabel: 'Club Day', prizeZAR: 50000, maxPlayers: 120, players: 0, swings: 0, phase: 'upcoming' })
    expect(data.holes.map((h: { holeNumber: number }) => h.holeNumber)).toEqual([12, 17])
    expect(db.find('golf_days', d => d.slug === 'clubday')).toMatchObject({ prize_pence: 5_000_000, created_by: ADMIN.id })
  })

  it('refuses a bad link, a long tab label, a past date, no holes, and holes that cannot be played', async () => {
    asAdmin()
    for (const over of [
      { slug: 'x' }, { slug: 'has space' }, { tabLabel: 'Much Too Long Label' }, { playsOn: addDays(today(), -1) },
      { playsOn: '2 October' }, { holeIds: [] }, { prizeRand: 0 }, { maxPlayers: 0 },
    ]) {
      expect((await create(valid(over))).status, JSON.stringify(over)).toBe(400)
    }
    for (const [holeIds, why] of [[[EAST_1], /par 3/], [[EAST_5], /140/], [[ELSEWHERE_3], /not open/], [['f0000000-0000-4000-8000-0000000000ff'], /does not exist/]] as const) {
      const res = await create(valid({ holeIds }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(why)
    }
    expect(db.rows('golf_days')).toHaveLength(0)
  })

  it('refuses a link that is taken', async () => {
    asAdmin(); seedDay()
    expect((await create(valid({ slug: 'bombsquad' }))).status).toBe(409)
  })

  it('lists golf days with players, swings and claims', async () => {
    const day = seedDay(); joined(day, USER_A); joined(day, USER_B)
    db.seed('bets', { user_id: USER_A.id, tier: 'tier_golf_day', golf_day_id: day.id, status: 'claimed', hole_id: EAST_2 })
    asAdmin()
    const { data } = await (await listDays()).json()
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ slug: 'bombsquad', players: 2, swings: 1, claimed: 1, maxPlayers: 200, prizeZAR: 100000 })
  })

  it('switching a day off hides its tab and stops its swing; on again, both come back', async () => {
    const day = seedDay(); joined(day); asAdmin()
    const off = await patch(String(day.id), { disabled: true })
    expect((await off.json()).data.disabledAt).toBeTruthy()
    player()
    expect((await (await myTab()).json()).tab).toBeNull()
    expect((await (await swing()).json()).code).toBe('GOLF_DAY_CLOSED')
    asAdmin()
    await patch(String(day.id), { disabled: false })
    asUser(USER_A)
    expect((await swing()).status).toBe(200)
  })

  it('changes the holes, prize and places; a bad hole or unknown day is refused', async () => {
    const day = seedDay(); asAdmin()
    const res = await patch(String(day.id), { holeIds: [EAST_12], prizeRand: 75000, maxPlayers: 180 })
    expect((await res.json()).data).toMatchObject({ prizeZAR: 75000, maxPlayers: 180, holes: [{ holeNumber: 12 }] })
    expect(db.rows('golf_day_holes').map(h => h.hole_id)).toEqual([EAST_12])
    expect((await patch(String(day.id), { holeIds: [EAST_1] })).status).toBe(400)
    expect((await patch(String(day.id), {})).status).toBe(400)
    expect((await patch('nope', { maxPlayers: 5 })).status).toBe(400)
    expect((await patch(USER_C.id, { maxPlayers: 5 })).status).toBe(404)
  })

  it('lists the players and where each swing stands', async () => {
    const day = seedDay()
    db.seed('profiles', { id: USER_A.id, name: 'Alice', email: USER_A.email }, { id: USER_B.id, name: 'Bob', email: USER_B.email })
    joined(day, USER_A); joined(day, USER_B)
    db.seed('bets', { user_id: USER_B.id, tier: 'tier_golf_day', golf_day_id: day.id, status: 'miss', hole_id: WEST_17 })
    asAdmin()
    const { data } = await (await listPlayers(new Request('http://x'), idParams(String(day.id)))).json()
    expect(data.map((p: { name: string; swing: { status: string; hole: string } | null }) => [p.name, p.swing?.status ?? null, p.swing?.hole ?? null])).toEqual([
      ['Alice', null, null],
      ['Bob', 'miss', 'Royal Johannesburg & Kensington – West, hole 17'],
    ])
  })
})

describe('Add to calendar', () => {
  const calendar = (slug = 'bombsquad') => dayCalendar(new Request(`http://x/api/golf-days/${slug}/calendar`), slugParams(slug))
  /** The .ics with its folded lines joined back up, as a calendar reads it. */
  const unfold = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n')
  const field = (lines: string[], name: string) => lines.find(l => l.startsWith(`${name}:`) || l.startsWith(`${name};`))

  const hole = (course: string, holeNumber: number, distanceMetres: number) => ({
    holeId: `${course}-${holeNumber}`, holeNumber, par: 3, distanceMetres,
    course: { id: course, name: `Royal Johannesburg & Kensington – ${course}`, location: 'Linksfield, Gauteng', region: 'Gauteng' },
  })
  const DAY_OF: CalendarDay = {
    slug: 'bombsquad', name: 'Bomb Squad Golf Day', tabLabel: 'BS', playsOn: '2026-10-02', prizeZAR: 100000,
    holes: [hole('East', 16, 152), hole('West', 17, 161)],
  }
  const SITE = 'https://www.getluckyholeinone.com'

  it('is the day itself, all day, with the holes, the link and the prize', () => {
    const event = golfDayEvent(DAY_OF, { site: SITE, venue: 'Royal Johannesburg' })
    expect(event).toMatchObject({
      uid: 'golf-day-bombsquad@www.getluckyholeinone.com',
      title: 'Bomb Squad Golf Day: free swing for R100\u00a0000',
      start: '20261002',
      end: '20261003',
      location: 'Royal Johannesburg, Linksfield, Gauteng',
      url: 'https://www.getluckyholeinone.com/golf-day/bombsquad',
    })
    expect(event.details).toContain('Play it at East 16 (152 m) or West 17 (161 m).')
    expect(event.details).toContain('open the BS tab in Get Lucky')
    expect(event.details).toContain('https://www.getluckyholeinone.com/golf-day/bombsquad')
    expect(event.reminder).toBe('Bomb Squad Golf Day is today. Open the BS tab in Get Lucky for your free swing.')
  })

  it('without a short venue, names the club as the courses table does; a day on the 31st ends next year', () => {
    const event = golfDayEvent({ ...DAY_OF, playsOn: '2026-12-31' }, { site: `${SITE}/`, venue: null })
    expect(event.location).toBe('Royal Johannesburg & Kensington, Linksfield, Gauteng')
    expect([event.start, event.end]).toEqual(['20261231', '20270101'])
    expect(event.url).toBe('https://www.getluckyholeinone.com/golf-day/bombsquad')
  })

  it('writes a well-formed .ics: CRLF, lines of at most 75 bytes, text escaped, a reminder at 7am on the day', () => {
    const event = golfDayEvent({ ...DAY_OF, name: 'Smith, Jones; & Co\\ Golf Day' }, { site: SITE, venue: 'Royal Johannesburg' })
    const ics = toIcs(event, new Date('2026-09-25T10:11:12.345Z'))
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)

    const lines = unfold(ics)
    expect(lines.slice(0, 2)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0'])
    expect(field(lines, 'DTSTAMP')).toBe('DTSTAMP:20260925T101112Z')
    expect(field(lines, 'DTSTART')).toBe('DTSTART;VALUE=DATE:20261002')
    expect(field(lines, 'DTEND')).toBe('DTEND;VALUE=DATE:20261003')
    expect(field(lines, 'SUMMARY')).toBe('SUMMARY:Smith\\, Jones\\; & Co\\\\ Golf Day: free swing for R100\u00a0000')
    expect(field(lines, 'LOCATION')).toBe('LOCATION:Royal Johannesburg\\, Linksfield\\, Gauteng')
    expect(field(lines, 'DESCRIPTION')).toContain('\\n\\nPlay it at East 16 (152 m) or West 17 (161 m).')
    expect(lines).toContain('TRIGGER:PT7H')
    // Folding never splits a character: the unfolded text is the text.
    expect(lines.join('\n')).toContain('free swing for R100\u00a0000')
  })

  it('gives Android a Google Calendar link carrying the same event', () => {
    const event = golfDayEvent(DAY_OF, { site: SITE, venue: 'Royal Johannesburg' })
    const url = new URL(googleCalendarUrl(event))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: 'TEMPLATE', text: event.title, dates: '20261002/20261003', details: event.details, location: event.location,
    })
  })

  it('GET serves the golf day as text/calendar, from the database and the theme', async () => {
    const day = seedDay({ plays_on: '2026-10-02', tab_label: 'BS' }); joined(day, USER_B)
    const res = await calendar()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('inline; filename="bombsquad.ics"')
    const body = await res.text()
    const lines = unfold(body)
    expect(field(lines, 'DTSTART')).toBe('DTSTART;VALUE=DATE:20261002')
    expect(field(lines, 'LOCATION')).toBe('LOCATION:Royal Johannesburg\\, Linksfield\\, Gauteng')
    expect(field(lines, 'URL')).toBe(`URL:${siteUrl()}/golf-day/bombsquad`)
    expect(field(lines, 'DESCRIPTION')).toContain('East 2 (211 m) or West 17 (185 m)')
    expect(body).not.toContain(USER_B.id)
  })

  it('GET: 404 for an unknown, malformed or switched-off golf day', async () => {
    seedDay({ slug: 'off', disabled_at: new Date().toISOString() })
    seedDay()
    expect((await calendar('nope')).status).toBe(404)
    expect((await calendar('BAD SLUG')).status).toBe(404)
    expect((await calendar('off')).status).toBe(404)
    expect((await calendar()).status).toBe(200)
  })
})
