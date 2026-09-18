/**
 * /api/bets/free — the free swing, the freemium way in.
 *
 * Invariants pinned here:
 *  - one per account, for life, and a second attempt never creates a bet
 *  - it never touches the money path: no ledger row, no payment, stake 0
 *  - the prize is R10,000 and comes from the tier table, never from the body
 *  - the paid gates still apply: signed in, 18+, not suspended, real target
 *  - GET tells the screen whether to offer the card at all
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID, type FakeUser } from '../helpers/fake-supabase'
import { GET, POST } from '@/app/api/bets/free/route'
import { FREE_TIER } from '@/lib/tiers'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

const OTHER_COURSE = '55555555-5555-4555-8555-555555555555'
let db: FakeDb

function asUser(user: FakeUser | null = USER_A) {
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user }))
}

function verifiedProfile(userId = USER_A.id) {
  return db.seed('profiles', { id: userId, age_verified_at: '2026-01-01T00:00:00Z', total_attempts: 0 })[0]
}

function seedTarget(over: { active?: boolean; partner?: boolean; par?: number; metres?: number | null } = {}) {
  db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek', is_partner: over.partner ?? true }, { id: OTHER_COURSE, name: 'Elsewhere', is_partner: true })
  db.seed('holes', {
    id: HOLE_ID, course_id: COURSE_ID, hole_number: 4, is_active: over.active ?? true,
    par: over.par ?? 3, distance_metres: over.metres === undefined ? 165 : over.metres,
  })
}

const body = (over: Record<string, unknown> = {}) => ({ courseId: COURSE_ID, holeId: HOLE_ID, ...over })
const post = (b: unknown) => POST(jsonRequest('http://x/api/bets/free', b) as never)

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('gates', () => {
  it('401 without a session', async () => {
    asUser(null)
    expect((await post(body())).status).toBe(401)
  })

  it('400 INVALID_INPUT without a real course and hole', async () => {
    asUser()
    for (const over of [{ courseId: undefined }, { holeId: undefined }, { holeId: 'not-a-uuid' }]) {
      const res = await post(body(over))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('INVALID_INPUT')
    }
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('403 AGE_NOT_VERIFIED when the profile has no age_verified_at', async () => {
    asUser(); db.seed('profiles', { id: USER_A.id, age_verified_at: null }); seedTarget()
    const res = await post(body())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('AGE_NOT_VERIFIED')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('403 ACCOUNT_SUSPENDED for a suspended profile', async () => {
    asUser(); seedTarget()
    verifiedProfile().suspended_at = '2026-09-01T00:00:00Z'
    const res = await post(body())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ACCOUNT_SUSPENDED')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('400 when the hole is not a playable par 3 at a partner course', async () => {
    asUser(); verifiedProfile()
    for (const [over, code] of [
      [{ active: false }, 'HOLE_INACTIVE'],
      [{ metres: 90 }, 'HOLE_NOT_ELIGIBLE'],
      [{ partner: false }, 'COURSE_NOT_PARTNER'],
    ] as const) {
      db = new FakeDb(); asUser(); verifiedProfile(); seedTarget(over)
      const res = await post(body())
      expect(res.status, code).toBe(400)
      expect((await res.json()).code).toBe(code)
      expect(db.rows('bets')).toHaveLength(0)
    }
  })

  it('400 HOLE_INVALID when the hole belongs to another course', async () => {
    asUser(); verifiedProfile(); seedTarget()
    const res = await post(body({ courseId: OTHER_COURSE }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('HOLE_INVALID')
  })
})

describe('the free bet', () => {
  beforeEach(() => { asUser(); verifiedProfile(); seedTarget() })

  it('grants an active bet with no stake and the R10,000 prize', async () => {
    const before = Date.now()
    const res = await post(body())
    expect(res.status).toBe(200)
    const { betId, tier } = await res.json()

    const bet = db.find('bets', b => b.id === betId)!
    expect(bet).toMatchObject({
      user_id: USER_A.id,
      course_id: COURSE_ID,
      hole_id: HOLE_ID,
      tier: 'tier_free',
      stake_pence: 0,
      potential_win_pence: 1_000_000,
      status: 'active',
      updated_by: USER_A.id,
    })
    expect(tier).toMatchObject({ tier: 'tier_free', stakeZAR: 0, winZAR: 10000 })
    expect(FREE_TIER.winZAR * 100).toBe(1_000_000)

    // A play window, exactly as a paid entry gets.
    const expires = Date.parse(bet.expires_at as string)
    expect(expires).toBeGreaterThanOrEqual(before + 24 * 3_600_000 - 1000)
  })

  it('never writes to the payments ledger', async () => {
    await post(body())
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })

  it('carries a deterministic reference, so the unique index is a second lock', async () => {
    const { betId } = await (await post(body())).json()
    expect(db.find('bets', b => b.id === betId)!.payment_intent_id).toBe(`free_${USER_A.id}`)
  })

  it('increments the profile attempt counter', async () => {
    await post(body())
    expect(db.find('profiles', p => p.id === USER_A.id)!.total_attempts).toBe(1)
  })
})

describe('one per account', () => {
  beforeEach(() => { asUser(); verifiedProfile(); seedTarget() })

  it('409 FREE_SWING_USED on the second attempt, and creates nothing', async () => {
    expect((await post(body())).status).toBe(200)
    const res = await post(body())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('FREE_SWING_USED')
    expect(db.rows('bets')).toHaveLength(1)
  })

  it('409 even when the earlier free bet is long finished', async () => {
    await post(body())
    db.rows('bets')[0].status = 'miss'
    expect((await post(body())).status).toBe(409)
    expect(db.rows('bets')).toHaveLength(1)
  })

  it('a race that slips past the check is still caught by the unique reference', async () => {
    // Two taps at once: the pre-check found nothing, the insert collides.
    db.seed('bets', { user_id: USER_A.id, tier: 'tier_1', status: 'active', payment_intent_id: `free_${USER_A.id}` })
    const res = await post(body())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('FREE_SWING_USED')
    expect(db.rows('bets')).toHaveLength(1)
  })

  it('a paid bet does not use up the free swing', async () => {
    db.seed('bets', { user_id: USER_A.id, tier: 'tier_1', status: 'miss', payment_intent_id: 'gl_paid_1' })
    expect((await post(body())).status).toBe(200)
    expect(db.rows('bets').filter(b => b.tier === 'tier_free')).toHaveLength(1)
  })

  it('another golfer still gets theirs', async () => {
    await post(body())
    asUser(USER_B); verifiedProfile(USER_B.id)
    expect((await post(body())).status).toBe(200)
    expect(db.rows('bets').filter(b => b.tier === 'tier_free')).toHaveLength(2)
  })
})

describe('GET eligibility', () => {
  it('says not eligible without a session, and never throws', async () => {
    asUser(null)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ eligible: false, used: false, tier: { tier: 'tier_free', winZAR: 10000 } })
  })

  it('eligible for a fresh account, not eligible once the swing is taken', async () => {
    asUser(); verifiedProfile(); seedTarget()
    expect(await (await GET()).json()).toMatchObject({ eligible: true, used: false, ageVerified: true })
    await post(body())
    expect(await (await GET()).json()).toMatchObject({ eligible: false, used: true })
  })

  it('still eligible before the 18+ check, which the screen can send them to', async () => {
    asUser(); db.seed('profiles', { id: USER_A.id, age_verified_at: null })
    expect(await (await GET()).json()).toMatchObject({ eligible: true, ageVerified: false })
  })

  it('not eligible while suspended', async () => {
    asUser(); verifiedProfile().suspended_at = '2026-09-01T00:00:00Z'
    expect(await (await GET()).json()).toMatchObject({ eligible: false })
  })
})
