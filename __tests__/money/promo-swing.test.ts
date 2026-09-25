/**
 * Promo codes (migration 027): one extra free swing per code, per golfer,
 * up to the code's cap and until its date.
 *
 * Invariants pinned here:
 *  - a code is good for one swing per golfer, and never more than its cap
 *    in total, even when the last use is raced (the insert is the lock)
 *  - an expired or switched-off code gives nothing
 *  - it never touches the money path: no ledger row, stake 0, and the prize
 *    comes from the tier table, never from the body
 *  - it is not the free swing: it neither uses up nor needs the free swing
 *  - the paid gates still apply: signed in, 18+, not suspended, real target
 *  - admins make, change, switch off and (while unused) delete codes, and
 *    see how each was used
 *  - the free swing report does not count a promo swing as a paid entry
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID, type FakeUser } from '../helpers/fake-supabase'
import { GET as check, POST as play } from '@/app/api/bets/promo/route'
import { GET as listPromos, POST as createPromo } from '@/app/api/admin/promos/route'
import { PATCH as patchPromo, DELETE as deletePromo } from '@/app/api/admin/promos/[promoId]/route'
import { GET as freeSwingReport } from '@/app/api/admin/reports/free-swings/route'
import { POST as playFree } from '@/app/api/bets/free/route'
import {
  PROMO_CODE_PATTERN, codeRefusal, generatePromoCode, normalisePromoCode, promoSwingReference, refusalFromDbError, toAdminPromo,
} from '@/lib/promo'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

const USER_C: FakeUser = { id: '66666666-6666-4666-8666-666666666666', email: 'c@example.com' }
const ADMIN: FakeUser = { id: '99999999-9999-4999-8999-999999999999', email: 'admin@example.com' }
const DAY = 24 * 3_600_000
let db: FakeDb

function asUser(user: FakeUser | null = USER_A) {
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user }))
}

function golfer(user: FakeUser = USER_A) {
  db.seed('profiles', { id: user.id, age_verified_at: '2026-01-01T00:00:00Z', total_attempts: 0 })
  asUser(user)
}

function asAdmin() {
  if (!db.find('profiles', p => p.id === ADMIN.id)) db.seed('profiles', { id: ADMIN.id, name: 'Admin', is_admin: true })
  asUser(ADMIN)
}

function seedTarget() {
  db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek', is_partner: true })
  db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 4, is_active: true, par: 3, distance_metres: 165 })
}

function seedCode(over: Record<string, unknown> = {}) {
  return db.seed('promo_codes', {
    code: 'GOLFDAY', max_uses: 50, expires_at: new Date(Date.now() + 7 * DAY).toISOString(),
    note: null, disabled_at: null, ...over,
  })[0]
}

const checkCode = (code: string) => check(new Request(`http://x/api/bets/promo?code=${encodeURIComponent(code)}`) as never)
const playCode = (code: string, over: Record<string, unknown> = {}) =>
  play(jsonRequest('http://x/api/bets/promo', { code, courseId: COURSE_ID, holeId: HOLE_ID, ...over }) as never)
const params = (promoId: string) => ({ params: Promise.resolve({ promoId }) })
const promoBets = () => db.rows('bets').filter(b => b.tier === 'tier_promo')

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('the rules, said once in TypeScript', () => {
  it('reads a code the way a golfer types it', () => {
    expect(normalisePromoCode('  golf day ')).toBe('GOLFDAY')
    expect(normalisePromoCode('gl-club-25')).toBe('GL-CLUB-25')
    expect(PROMO_CODE_PATTERN.test('GOLFDAY')).toBe(true)
    for (const bad of ['ABC', 'GOLF_DAY', 'GOLF!', 'x'.repeat(41).toUpperCase(), '']) expect(PROMO_CODE_PATTERN.test(bad), bad).toBe(false)
  })

  it('generates codes a person can read aloud', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const c = generatePromoCode()
      expect(c).toMatch(/^[A-HJKMNP-Z2-9]{8}$/)
      expect(PROMO_CODE_PATTERN.test(c)).toBe(true)
      seen.add(c)
    }
    expect(seen.size).toBe(50)
  })

  it('refuses in the trigger\'s order: off, then out of date, then used up', () => {
    const now = Date.now()
    const live = { max_uses: 2, expires_at: new Date(now + DAY).toISOString(), disabled_at: null }
    expect(codeRefusal(live, 1, now)).toBeNull()
    expect(codeRefusal(live, 2, now)).toBe('PROMO_CODE_EXHAUSTED')
    expect(codeRefusal({ ...live, expires_at: new Date(now - 1).toISOString() }, 2, now)).toBe('PROMO_CODE_EXPIRED')
    expect(codeRefusal({ ...live, expires_at: new Date(now - 1).toISOString(), disabled_at: 'x' }, 2, now)).toBe('PROMO_CODE_DISABLED')
  })

  it('recognises the trigger\'s refusals and nothing else', () => {
    expect(refusalFromDbError({ code: 'P0001', message: 'PROMO_CODE_EXHAUSTED' })).toBe('PROMO_CODE_EXHAUSTED')
    expect(refusalFromDbError({ code: 'P0001', message: 'something else' })).toBeNull()
    expect(refusalFromDbError({ code: '23505', message: 'PROMO_CODE_EXHAUSTED' })).toBeNull()
    expect(refusalFromDbError(null)).toBeNull()
  })

  it('reports a code\'s state for the admin list', () => {
    const now = Date.now()
    const row = { id: 'p', code: 'X1X1', max_uses: 3, expires_at: new Date(now + DAY).toISOString(), note: null, disabled_at: null, created_at: '' }
    expect(toAdminPromo(row, { uses: 1, claimed: 0, converted: 0 }, now)).toMatchObject({ status: 'active', uses: 1, remaining: 2 })
    expect(toAdminPromo(row, { uses: 5, claimed: 0, converted: 0 }, now)).toMatchObject({ status: 'used_up', remaining: 0 })
    expect(toAdminPromo({ ...row, disabled_at: 'x' }, undefined, now)).toMatchObject({ status: 'disabled', uses: 0 })
    expect(toAdminPromo({ ...row, expires_at: new Date(now - 1).toISOString() }, undefined, now).status).toBe('expired')
  })
})

describe('GET: checking a code', () => {
  it('401 without a session', async () => {
    asUser(null)
    expect((await checkCode('GOLFDAY')).status).toBe(401)
  })

  it('offers the swing for a live code, typed any old way, and spends nothing', async () => {
    golfer(); const code = seedCode()
    const res = await checkCode(' golfday ')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      code: 'GOLFDAY', expiresAt: code.expires_at, tier: { tier: 'tier_promo', stakeZAR: 0, winZAR: 10000 },
    })
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('404 PROMO_CODE_INVALID for an unknown or malformed code', async () => {
    golfer(); seedCode()
    for (const typed of ['NOPE1234', 'bad!code', 'ab']) {
      const res = await checkCode(typed)
      expect(res.status, typed).toBe(404)
      expect((await res.json()).code).toBe('PROMO_CODE_INVALID')
    }
  })

  it('400 INVALID_INPUT without a code at all', async () => {
    golfer()
    const res = await check(new Request('http://x/api/bets/promo') as never)
    expect(res.status).toBe(400)
  })

  it('says why a real code cannot be played', async () => {
    golfer()
    seedCode({ code: 'OLDCODE', expires_at: new Date(Date.now() - 1000).toISOString() })
    seedCode({ code: 'SWITCHEDOFF', disabled_at: '2026-09-01T00:00:00Z' })
    const full = seedCode({ code: 'FULLUP', max_uses: 1 })
    db.seed('bets', { user_id: USER_B.id, tier: 'tier_promo', promo_code_id: full.id, payment_intent_id: 'promo_x' })

    for (const [typed, reason] of [['OLDCODE', 'PROMO_CODE_EXPIRED'], ['SWITCHEDOFF', 'PROMO_CODE_DISABLED'], ['FULLUP', 'PROMO_CODE_EXHAUSTED']]) {
      const res = await checkCode(typed)
      expect(res.status, typed).toBe(409)
      expect((await res.json()).code).toBe(reason)
    }
  })

  it('409 PROMO_CODE_USED once this golfer has played it', async () => {
    golfer(); seedTarget(); seedCode()
    expect((await playCode('GOLFDAY')).status).toBe(200)
    const res = await checkCode('GOLFDAY')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PROMO_CODE_USED')
  })
})

describe('POST: the gates', () => {
  it('401 without a session', async () => {
    asUser(null)
    expect((await playCode('GOLFDAY')).status).toBe(401)
  })

  it('400 INVALID_INPUT without a real course and hole', async () => {
    golfer(); seedCode()
    for (const over of [{ courseId: undefined }, { holeId: 'not-a-uuid' }, { code: undefined }]) {
      const res = await playCode('GOLFDAY', over)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('INVALID_INPUT')
    }
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('403 AGE_NOT_VERIFIED before the 18+ check', async () => {
    db.seed('profiles', { id: USER_A.id, age_verified_at: null }); asUser(); seedTarget(); seedCode()
    const res = await playCode('GOLFDAY')
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('AGE_NOT_VERIFIED')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('403 ACCOUNT_SUSPENDED for a suspended golfer', async () => {
    golfer(); seedTarget(); seedCode()
    db.find('profiles', p => p.id === USER_A.id)!.suspended_at = '2026-09-01T00:00:00Z'
    const res = await playCode('GOLFDAY')
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ACCOUNT_SUSPENDED')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('400 when the hole is not playable, and the code is not spent', async () => {
    golfer(); seedCode()
    db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek', is_partner: true })
    db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 4, is_active: false, par: 3, distance_metres: 165 })
    const res = await playCode('GOLFDAY')
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('HOLE_INACTIVE')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('refuses an unknown, expired or switched-off code, and creates nothing', async () => {
    golfer(); seedTarget()
    seedCode({ code: 'OLDCODE', expires_at: new Date(Date.now() - 1000).toISOString() })
    seedCode({ code: 'SWITCHEDOFF', disabled_at: '2026-09-01T00:00:00Z' })
    for (const [typed, reason] of [['NOPE1234', 'PROMO_CODE_INVALID'], ['OLDCODE', 'PROMO_CODE_EXPIRED'], ['SWITCHEDOFF', 'PROMO_CODE_DISABLED']]) {
      const res = await playCode(typed)
      expect((await res.json()).code, typed).toBe(reason)
    }
    expect(db.rows('bets')).toHaveLength(0)
  })
})

describe('POST: the promo swing', () => {
  beforeEach(() => { golfer(); seedTarget() })

  it('grants an active bet with no stake and the R10,000 prize, tied to the code', async () => {
    const code = seedCode()
    const before = Date.now()
    const res = await playCode('golfday')
    expect(res.status).toBe(200)
    const { betId, tier, code: played } = await res.json()
    expect(played).toBe('GOLFDAY')
    expect(tier).toMatchObject({ tier: 'tier_promo', stakeZAR: 0, winZAR: 10000 })

    const bet = db.find('bets', b => b.id === betId)!
    expect(bet).toMatchObject({
      user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID,
      tier: 'tier_promo', stake_pence: 0, potential_win_pence: 1_000_000,
      promo_code_id: code.id, payment_intent_id: promoSwingReference(String(code.id), USER_A.id),
      status: 'active', updated_by: USER_A.id,
    })
    expect(Date.parse(bet.expires_at as string)).toBeGreaterThanOrEqual(before + DAY - 1000)
  })

  it('never writes to the payments ledger, and counts as an attempt', async () => {
    seedCode()
    await playCode('GOLFDAY')
    expect(db.rows('payfast_payments')).toHaveLength(0)
    expect(db.find('profiles', p => p.id === USER_A.id)!.total_attempts).toBe(1)
  })

  it('one swing per code per golfer: a second go is 409 PROMO_CODE_USED', async () => {
    seedCode()
    expect((await playCode('GOLFDAY')).status).toBe(200)
    const res = await playCode('GOLFDAY')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PROMO_CODE_USED')
    expect(promoBets()).toHaveLength(1)
  })

  it('a second code is a second swing', async () => {
    seedCode(); seedCode({ code: 'CLUBDAY' })
    expect((await playCode('GOLFDAY')).status).toBe(200)
    expect((await playCode('CLUBDAY')).status).toBe(200)
    expect(promoBets()).toHaveLength(2)
  })

  it('is extra to the free swing: neither uses up nor needs the other', async () => {
    seedCode()
    expect((await playCode('GOLFDAY')).status).toBe(200)
    expect((await playFree(jsonRequest('http://x/api/bets/free', { courseId: COURSE_ID, holeId: HOLE_ID }) as never)).status).toBe(200)
    expect(db.rows('bets').map(b => b.tier).sort()).toEqual(['tier_free', 'tier_promo'])
  })

  it('stops at the cap: the golfer after the last use is refused', async () => {
    seedCode({ max_uses: 2 })
    expect((await playCode('GOLFDAY')).status).toBe(200)
    golfer(USER_B)
    expect((await playCode('GOLFDAY')).status).toBe(200)
    golfer(USER_C)
    const res = await playCode('GOLFDAY')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PROMO_CODE_EXHAUSTED')
    expect(promoBets()).toHaveLength(2)
  })

  it('a race for the last use is settled by the insert, not the check', async () => {
    const code = seedCode({ max_uses: 1 })
    // Golfer B takes the last use after A's count and before A's insert.
    db.beforeInsert = table => {
      if (table !== 'bets') return
      db.beforeInsert = null
      db.seed('bets', { user_id: USER_B.id, tier: 'tier_promo', promo_code_id: code.id, payment_intent_id: promoSwingReference(String(code.id), USER_B.id) })
    }
    const res = await playCode('GOLFDAY')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PROMO_CODE_EXHAUSTED')
    expect(promoBets().map(b => b.user_id)).toEqual([USER_B.id])
  })

  it('a double tap that slips past the check is caught by the unique reference', async () => {
    const code = seedCode()
    // The other tap's bet lands between this one's check and its insert.
    db.beforeInsert = table => {
      if (table !== 'bets') return
      db.beforeInsert = null
      db.seed('bets', { user_id: USER_A.id, tier: 'tier_1', payment_intent_id: promoSwingReference(String(code.id), USER_A.id) })
    }
    const res = await playCode('GOLFDAY')
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PROMO_CODE_USED')
    expect(promoBets()).toHaveLength(0)
  })

  it('the prize comes from the tier table, never from the body', async () => {
    seedCode()
    const { betId } = await (await playCode('GOLFDAY', { potential_win_pence: 100_000_000, tier: 'tier_5', stake_pence: -1 })).json()
    expect(db.find('bets', b => b.id === betId)).toMatchObject({ tier: 'tier_promo', stake_pence: 0, potential_win_pence: 1_000_000 })
  })
})

describe('admin: making and watching codes', () => {
  const future = (days = 14) => new Date(Date.now() + days * DAY).toISOString()
  const create = (body: Record<string, unknown>) => createPromo(jsonRequest('http://x/api/admin/promos', body))

  it('non-admins never reach the handlers', async () => {
    golfer()
    const id = String(seedCode().id)
    expect((await listPromos()).status).toBe(403)
    expect((await create({ maxUses: 5, expiresAt: future() })).status).toBe(403)
    expect((await patchPromo(jsonRequest('http://x', { disabled: true }, { method: 'PATCH' }), params(id))).status).toBe(403)
    expect((await deletePromo(new Request('http://x', { method: 'DELETE' }), params(id))).status).toBe(403)
    expect(db.find('promo_codes', c => c.id === id)!.disabled_at).toBeNull()
  })

  it('creates a code: typed and tidied, or generated when left blank', async () => {
    asAdmin()
    const typed = await create({ code: ' club day 25 ', maxUses: 40, expiresAt: future(), note: 'Zimbali open day' })
    expect(typed.status).toBe(201)
    expect((await typed.json()).data).toMatchObject({ code: 'CLUBDAY25', maxUses: 40, uses: 0, remaining: 40, status: 'active', note: 'Zimbali open day' })

    const generated = await create({ maxUses: 10, expiresAt: future() })
    expect(generated.status).toBe(201)
    expect((await generated.json()).data.code).toMatch(/^[A-Z0-9]{8}$/)

    expect(db.rows('promo_codes').map(c => c.created_by)).toEqual([ADMIN.id, ADMIN.id])
  })

  it('refuses a bad code, a cap outside 1–100000, a past expiry, and a duplicate', async () => {
    asAdmin()
    for (const body of [
      { code: 'NO', maxUses: 5, expiresAt: future() },
      { code: 'BAD_CODE', maxUses: 5, expiresAt: future() },
      { code: 'GOODCODE', maxUses: 0, expiresAt: future() },
      { code: 'GOODCODE', maxUses: 100001, expiresAt: future() },
      { code: 'GOODCODE', maxUses: 5, expiresAt: new Date(Date.now() - 1000).toISOString() },
      { code: 'GOODCODE', maxUses: 5 },
    ]) {
      const res = await create(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(db.rows('promo_codes')).toHaveLength(0)

    expect((await create({ code: 'GOODCODE', maxUses: 5, expiresAt: future() })).status).toBe(201)
    const dup = await create({ code: 'goodcode', maxUses: 5, expiresAt: future() })
    expect(dup.status).toBe(409)
    expect(db.rows('promo_codes')).toHaveLength(1)
  })

  it('lists every code with its uses, claims and the golfers who staked after', async () => {
    const code = seedCode({ max_uses: 2 })
    seedCode({ code: 'UNUSED', created_at: new Date(Date.now() - DAY).toISOString() })
    const earlier = new Date(Date.now() - 2 * 3_600_000).toISOString()
    db.seed('bets',
      { user_id: USER_A.id, tier: 'tier_promo', promo_code_id: code.id, status: 'claimed', stake_pence: 0, created_at: earlier },
      { user_id: USER_B.id, tier: 'tier_promo', promo_code_id: code.id, status: 'miss', stake_pence: 0, created_at: earlier },
      // A stakes afterwards; B staked only before.
      { user_id: USER_A.id, tier: 'tier_1', status: 'miss', stake_pence: 5000, created_at: new Date().toISOString() },
      { user_id: USER_B.id, tier: 'tier_1', status: 'miss', stake_pence: 5000, created_at: new Date(Date.now() - 5 * 3_600_000).toISOString() },
    )
    asAdmin()
    const { data } = await (await listPromos()).json()
    expect(data.map((p: { code: string }) => p.code)).toEqual(['GOLFDAY', 'UNUSED'])
    expect(data[0]).toMatchObject({ uses: 2, remaining: 0, claimed: 1, converted: 1, status: 'used_up' })
    expect(data[1]).toMatchObject({ uses: 0, remaining: 50, claimed: 0, converted: 0, status: 'active' })
  })

  it('switching a code off stops it at once; on again, it works', async () => {
    const id = String(seedCode().id)
    asAdmin()
    const off = await patchPromo(jsonRequest('http://x', { disabled: true }, { method: 'PATCH' }), params(id))
    expect(off.status).toBe(200)
    expect((await off.json()).data.status).toBe('disabled')

    golfer(); seedTarget()
    expect((await (await playCode('GOLFDAY')).json()).code).toBe('PROMO_CODE_DISABLED')

    asAdmin()
    await patchPromo(jsonRequest('http://x', { disabled: false }, { method: 'PATCH' }), params(id))
    asUser(USER_A)
    expect((await playCode('GOLFDAY')).status).toBe(200)
  })

  it('raising the cap or moving the date reopens a code', async () => {
    const id = String(seedCode({ max_uses: 1, expires_at: new Date(Date.now() - 1000).toISOString() }).id)
    db.seed('bets', { user_id: USER_B.id, tier: 'tier_promo', promo_code_id: id, payment_intent_id: 'promo_b' })
    asAdmin()
    const res = await patchPromo(jsonRequest('http://x', { maxUses: 5, expiresAt: future() }, { method: 'PATCH' }), params(id))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ maxUses: 5, uses: 1, remaining: 4, status: 'active' })

    golfer(); seedTarget()
    expect((await playCode('GOLFDAY')).status).toBe(200)
  })

  it('PATCH: 400 for an empty body or a bad id, 404 for a code that is not there', async () => {
    asAdmin()
    const id = String(seedCode().id)
    expect((await patchPromo(jsonRequest('http://x', {}, { method: 'PATCH' }), params(id))).status).toBe(400)
    expect((await patchPromo(jsonRequest('http://x', { maxUses: 2 }, { method: 'PATCH' }), params('nope'))).status).toBe(400)
    expect((await patchPromo(jsonRequest('http://x', { maxUses: 2 }, { method: 'PATCH' }), params(USER_C.id))).status).toBe(404)
  })

  it('deletes a code nobody has played; a played one stays on record', async () => {
    const unused = String(seedCode({ code: 'TYPO' }).id)
    const used = String(seedCode().id)
    db.seed('bets', { user_id: USER_B.id, tier: 'tier_promo', promo_code_id: used, payment_intent_id: 'promo_b' })
    asAdmin()
    expect((await deletePromo(new Request('http://x', { method: 'DELETE' }), params(unused))).status).toBe(200)
    const res = await deletePromo(new Request('http://x', { method: 'DELETE' }), params(used))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PROMO_CODE_IN_USE')
    expect(db.rows('promo_codes').map(c => c.id)).toEqual([used])
  })
})

describe('the free swing report', () => {
  it('does not count a promo swing after a free swing as a paid entry', async () => {
    const code = seedCode()
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
    db.seed('bets',
      { user_id: USER_B.id, tier: 'tier_free', stake_pence: 0, potential_win_pence: 1_000_000, status: 'miss', created_at: hoursAgo(3) },
      { user_id: USER_B.id, tier: 'tier_promo', promo_code_id: code.id, stake_pence: 0, potential_win_pence: 1_000_000, status: 'miss', created_at: hoursAgo(1) },
    )
    asAdmin()
    const report = await (await freeSwingReport()).json()
    expect(report).toMatchObject({ taken: 1, convertedEver: 0, paidBetsAfterFree: 0, revenueAfterFreeCents: 0 })
  })
})
