/**
 * POST /api/bets/create — where a paid ledger row becomes a live bet.
 *
 * The invariant: a bet exists only for a `complete` payfast_payments row that
 * belongs to the signed-in user, and the bet's tier/course/hole come from that
 * row, never from the request body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID, type FakeClientOptions } from '../helpers/fake-supabase'
import { POST } from '@/app/api/bets/create/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb

function asUser(user = USER_A, opts: FakeClientOptions = {}) {
  const client = createFakeClient(db, { user, ...opts })
  serverClient.createClient.mockResolvedValue(client)
  return client
}

function verifiedProfile(userId = USER_A.id) {
  return db.seed('profiles', { id: userId, age_verified_at: '2026-01-01T00:00:00Z', total_attempts: 0 })[0]
}

function ledgerRow(over: Record<string, unknown> = {}) {
  return db.seed('payfast_payments', {
    m_payment_id: 'gl_tier_1_1700000000000',
    pf_payment_id: '1089250',
    user_id: USER_A.id,
    course_id: COURSE_ID,
    hole_id: HOLE_ID,
    tier: 'tier_1',
    amount_cents: 5000,
    status: 'complete',
    ...over,
  })[0]
}

const body = (over: Record<string, unknown> = {}) => ({
  courseId: COURSE_ID, holeId: HOLE_ID, tier: 'tier_1', paymentIntentId: 'gl_tier_1_1700000000000', ...over,
})
const post = (b: unknown) => POST(jsonRequest('http://x/api/bets/create', b) as never)

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('gates', () => {
  it('400 on missing fields, before touching the database', async () => {
    asUser()
    for (const missing of ['courseId', 'holeId', 'tier', 'paymentIntentId']) {
      const res = await post(body({ [missing]: undefined }))
      expect(res.status, `missing ${missing}`).toBe(400)
    }
  })

  it('400 on an unknown tier', async () => {
    asUser()
    expect((await post(body({ tier: 'tier_99' }))).status).toBe(400)
  })

  it('401 without a session', async () => {
    asUser(null as never)
    expect((await post(body())).status).toBe(401)
  })

  it('403 AGE_NOT_VERIFIED when the profile has no age_verified_at', async () => {
    asUser()
    db.seed('profiles', { id: USER_A.id, age_verified_at: null })
    ledgerRow()
    const res = await post(body())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('AGE_NOT_VERIFIED')
    expect(db.rows('bets')).toHaveLength(0)
  })
})

describe('proof of payment', () => {
  beforeEach(() => { asUser(); verifiedProfile() })

  it('202 PAYMENT_PENDING when the ITN has not landed, and creates nothing', async () => {
    const res = await post(body())
    expect(res.status).toBe(202)
    expect((await res.json()).code).toBe('PAYMENT_PENDING')
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('402 when the ledger row is amount_mismatch', async () => {
    ledgerRow({ status: 'amount_mismatch', tier: null })
    const res = await post(body())
    expect(res.status).toBe(402)
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('402 when the payment belongs to a different user', async () => {
    ledgerRow({ user_id: USER_B.id })
    const res = await post(body())
    expect(res.status).toBe(402)
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('402 when the ledger tier and amount disagree (defence in depth)', async () => {
    ledgerRow({ tier: 'tier_5', amount_cents: 5000 })
    expect((await post(body())).status).toBe(402)
  })

  it('500 PAYMENT_LOOKUP_FAILED when the ledger table is unreachable, creating nothing', async () => {
    asUser(USER_A, { failTable: { payfast_payments: { code: '42P01', message: 'relation does not exist' } } })
    const res = await post(body())
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('PAYMENT_LOOKUP_FAILED')
    expect(db.rows('bets')).toHaveLength(0)
  })
})

describe('bet creation', () => {
  beforeEach(() => { asUser(); verifiedProfile() })

  it('creates an active bet from the ledger row, ignoring the body\'s tier/course/hole', async () => {
    ledgerRow()
    const res = await post(body({ tier: 'tier_5', courseId: 'course-from-body', holeId: 'hole-from-body' }))
    expect(res.status).toBe(200)
    const { betId } = await res.json()

    const bet = db.find('bets', b => b.id === betId)!
    expect(bet).toMatchObject({
      user_id: USER_A.id,
      course_id: COURSE_ID,
      hole_id: HOLE_ID,
      tier: 'tier_1',
      stake_pence: 5000,
      potential_win_pence: 2_500_000,
      payment_intent_id: 'gl_tier_1_1700000000000',
      status: 'active',
    })
  })

  it('increments the profile attempt counter', async () => {
    ledgerRow()
    await post(body())
    expect(db.find('profiles', p => p.id === USER_A.id)!.total_attempts).toBe(1)
  })

  it('is idempotent: a second call for the same payment returns the same bet', async () => {
    ledgerRow()
    const first = await (await post(body())).json()
    const second = await (await post(body())).json()
    expect(second.betId).toBe(first.betId)
    expect(db.rows('bets')).toHaveLength(1)
  })

  it('survives losing an insert race: unique violation resolves to the winner\'s bet', async () => {
    ledgerRow()
    // Simulate the other tab having inserted between our lookup and our insert.
    const [winner] = db.seed('bets', { user_id: USER_A.id, payment_intent_id: 'gl_tier_1_1700000000000', status: 'active' })
    const client = asUser()
    const originalFrom = client.from.bind(client)
    let lookups = 0
    client.from = ((table: string) => {
      const b = originalFrom(table)
      if (table === 'bets') {
        const origMaybe = b.maybeSingle.bind(b)
        b.maybeSingle = () => {
          // First lookup pretends the winner is not there yet; later ones see it.
          if (lookups++ === 0) { b.eq('id', 'nothing-matches'); }
          return origMaybe()
        }
      }
      return b
    }) as typeof client.from

    const res = await post(body())
    expect(res.status).toBe(200)
    expect((await res.json()).betId).toBe(winner.id)
    expect(db.rows('bets')).toHaveLength(1)
  })

  // Documented in AUDIT.md B.3. The ITN rewrites bets.payment_intent_id to
  // PayFast's id after the bet exists; a retried /payment-return then fails to
  // find the bet by the original reference and inserts a second one. This test
  // asserts the correct behaviour and is marked `fails` until Batch 3 fixes it.
  it.fails('does not create a second bet after the ITN has swapped the reference (Batch 3)', async () => {
    ledgerRow()
    const first = await (await post(body())).json()
    db.find('bets', b => b.id === first.betId)!.payment_intent_id = '1089250'

    const second = await (await post(body())).json()
    expect(second.betId).toBe(first.betId)
    expect(db.rows('bets')).toHaveLength(1)
  })
})
