/**
 * A retried charge is one charge (migration 047).
 *
 * The phone sends Idempotency-Key with a saved-card or wallet charge. The
 * same key twice, whether a retry after a lost answer or two taps that
 * raced, means one ledger row, one call to the provider, and the same
 * answer: a complete row grants the same bet, a quiet provider is "check
 * before paying again", a refusal is the same refusal. Different keys, or
 * none, are what they always were.
 *
 * Also here: the free, promo and golf-day swings say which bet they already
 * made, a claim submitted twice lands once, and the play gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A, COURSE_ID, HOLE_ID, type FakeUser } from '../helpers/fake-supabase'
import { POST as charge } from '@/app/api/payments/payfast/charge/route'
import { POST as walletCharge } from '@/app/api/payments/wallet/charge/route'
import { POST as freeSwing } from '@/app/api/bets/free/route'
import { isIdempotencyConflict, readIdempotencyKey } from '@/lib/payments/idempotency'
import { enforceRateLimit, RULES } from '@/lib/rate-limit'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb
const TOKEN = 'dc0521d3-55fe-269b-fa00-b647310d760f'
const KEY = '3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b'
const WALLET_TOKEN = 'J2V4YW1wbGVQYXltZW50TWV0aG9kVG9rZW4n'

function env(over: Record<string, string | undefined> = {}) {
  vi.unstubAllEnvs()
  const base: Record<string, string | undefined> = {
    PAYFAST_MERCHANT_ID: '10012345', PAYFAST_MERCHANT_KEY: 'sandboxkey123', PAYFAST_PASSPHRASE: 'unit-test-passphrase', PAYFAST_SANDBOX: 'true',
    STITCH_CLIENT_ID: 'test-abc123', STITCH_CLIENT_SECRET: 'shh', STITCH_APPLE_MERCHANT_IDENTIFIER: 'merchant.money.stitch.getlucky', STITCH_WEBHOOK_SECRET: `whsec_${Buffer.from('unit-test-webhook-secret-32-bytes!!').toString('base64')}`,
    NEXT_PUBLIC_SITE_URL: 'https://preview.example.com', VERCEL_ENV: 'preview', ...over,
  }
  for (const [k, v] of Object.entries(base)) if (v !== undefined) vi.stubEnv(k, v)
}
function asUser(user: FakeUser | null) {
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user }))
}
function seed(opts: { card?: boolean; verified?: boolean } = {}) {
  db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek', is_partner: true })
  db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 4, par: 3, distance_metres: 165, is_active: true })
  db.seed('profiles', { id: USER_A.id, age_verified_at: opts.verified === false ? null : '2026-01-01T00:00:00Z', total_attempts: 0 })
  if (opts.card !== false) db.seed('payment_cards', { user_id: USER_A.id, token: TOKEN, label: 'Saved card', created_at: '2026-09-17T06:00:00Z', last_used_at: null })
}
const payfastOk = () => vi.fn(async () => new Response(JSON.stringify({ code: 200, status: 'success', data: { response: { pf_payment_id: '2200001' }, message: 'Success' } }), { status: 200 }))
const payfastQuiet = () => vi.fn(async () => { throw new Error('The operation was aborted due to timeout') })
const payfastNo = () => vi.fn(async () => new Response(JSON.stringify({ code: 400, status: 'failed', data: { response: false, message: 'Insufficient funds' } }), { status: 400 }))

const good = { tier: 'tier_1', courseId: COURSE_ID, holeId: HOLE_ID }
function post(body: unknown, key?: string) {
  const req = jsonRequest('http://x/api/payments/payfast/charge', body)
  if (key) req.headers.set('Idempotency-Key', key)
  return charge(req as never)
}

beforeEach(() => {
  db = new FakeDb()
  env()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.stubGlobal('fetch', payfastOk())
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('readIdempotencyKey', () => {
  it('reads a well-formed key, none when the header is absent, and 400 on a malformed one', () => {
    expect(readIdempotencyKey(new Request('http://x', { headers: { 'Idempotency-Key': KEY } })).key).toBe(KEY)
    expect(readIdempotencyKey(new Request('http://x')).key).toBeNull()
    const bad = readIdempotencyKey(new Request('http://x', { headers: { 'Idempotency-Key': 'short' } }))
    expect(bad.key).toBeNull()
    expect(bad.response?.status).toBe(400)
    expect(readIdempotencyKey(new Request('http://x', { headers: { 'Idempotency-Key': 'a'.repeat(65) } })).response?.status).toBe(400)
    expect(readIdempotencyKey(new Request('http://x', { headers: { 'Idempotency-Key': 'has spaces in it' } })).response?.status).toBe(400)
  })
  it('knows the unique index on the key from any other 23505', () => {
    expect(isIdempotencyConflict({ code: '23505', message: 'duplicate key value violates unique constraint "payfast_payments_user_id_idempotency_key_key"' })).toBe(true)
    expect(isIdempotencyConflict({ code: '23505', message: 'duplicate key value violates unique constraint "bets_payment_intent_id_key"' })).toBe(false)
    expect(isIdempotencyConflict({ code: '42P01', message: 'idempotency' })).toBe(false)
    expect(isIdempotencyConflict(null)).toBe(false)
  })
})

describe('saved-card charge with Idempotency-Key', () => {
  it('the same key twice: one ledger row, one PayFast call, the same bet, replayed', async () => {
    asUser(USER_A); seed()
    const f = payfastOk(); vi.stubGlobal('fetch', f)
    const first = await post(good, KEY)
    expect(first.status).toBe(200)
    const a = await first.json()
    expect(a.replayed).toBeUndefined()

    const second = await post(good, KEY)
    expect(second.status).toBe(200)
    const b = await second.json()
    expect(b).toMatchObject({ betId: a.betId, m_payment_id: a.m_payment_id, replayed: true })

    expect(f).toHaveBeenCalledTimes(1)
    expect(db.rows('payfast_payments')).toHaveLength(1)
    expect(db.rows('payfast_payments')[0]).toMatchObject({ idempotency_key: KEY, status: 'complete' })
    expect(db.rows('bets')).toHaveLength(1)
  })

  it('a quiet PayFast then the same key: 409 CHARGE_UNKNOWN with the same reference and no second charge', async () => {
    asUser(USER_A); seed()
    vi.stubGlobal('fetch', payfastQuiet())
    const first = await post(good, KEY)
    expect(first.status).toBe(409)
    const { m_payment_id } = await first.json()

    const f = payfastOk(); vi.stubGlobal('fetch', f)
    const second = await post(good, KEY)
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ code: 'CHARGE_UNKNOWN', m_payment_id, replayed: true })
    expect(f).not.toHaveBeenCalled()
    expect(db.rows('payfast_payments')).toHaveLength(1)
  })

  it('a refusal then the same key: the same 402, nothing sent again', async () => {
    asUser(USER_A); seed()
    vi.stubGlobal('fetch', payfastNo())
    expect((await post(good, KEY)).status).toBe(402)
    const f = payfastOk(); vi.stubGlobal('fetch', f)
    const again = await post(good, KEY)
    expect(again.status).toBe(402)
    expect(await again.json()).toMatchObject({ code: 'CARD_DECLINED', replayed: true })
    expect(f).not.toHaveBeenCalled()
    expect(db.rows('bets')).toHaveLength(0)
  })

  it('two requests with the same key racing past the lookup: the second finds the unique index, drops its row and replays the first', async () => {
    asUser(USER_A); seed()
    const f = payfastOk(); vi.stubGlobal('fetch', f)
    // Just as this request reserves its row (the locked database step), the
    // twin has already landed, been charged and completed with the same key.
    const admin = createFakeClient(db)
    const rpc = admin.rpc.bind(admin)
    admin.rpc = ((name: string, args: unknown) => {
      if (name === 'reserve_saved_card_charge' && !db.find('payfast_payments', r => r.m_payment_id === 'gl_twin')) {
        db.seed('payfast_payments', { m_payment_id: 'gl_twin', user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', amount_cents: 5000, status: 'complete', pf_payment_id: '2200009', idempotency_key: KEY, raw_payload: { source: 'saved_card' } })
      }
      return rpc(name, args)
    }) as typeof admin.rpc
    adminClient.createAdminClient.mockImplementation(() => admin)
    const res = await post(good, KEY)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ m_payment_id: 'gl_twin', replayed: true })
    expect(f).not.toHaveBeenCalled()
    expect(db.rows('payfast_payments').map(r => r.m_payment_id)).toEqual(['gl_twin'])
    expect(db.rows('bets')).toHaveLength(1)
  })

  it('different keys are different charges; no key is what it always was', async () => {
    asUser(USER_A); seed()
    const f = payfastOk(); vi.stubGlobal('fetch', f)
    expect((await post(good, KEY)).status).toBe(200)
    expect((await post(good, 'another-key-0123456789')).status).toBe(200)
    expect((await post(good)).status).toBe(200)
    expect(f).toHaveBeenCalledTimes(3)
    expect(db.rows('payfast_payments').map(r => r.idempotency_key)).toEqual([KEY, 'another-key-0123456789', null])
  })

  it('400 on a malformed key before anything is touched', async () => {
    asUser(USER_A); seed()
    const res = await post(good, 'nope')
    expect(res.status).toBe(400)
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })
})

describe('wallet charge with Idempotency-Key', () => {
  const initiated = { data: { initiateTransaction: { __typename: 'ApplePayTransaction', id: 'tx-1', interactionUrl: null, state: { __typename: 'TransactionSuccess' } } } }
  function stitchFetch() {
    let graphqlCalls = 0
    const fn = vi.fn(async (url: string) => {
      if (url.endsWith('/connect/token')) return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer' }), { status: 200 })
      graphqlCalls++
      return new Response(JSON.stringify(initiated), { status: 200 })
    })
    return Object.assign(fn, { graphql: () => graphqlCalls })
  }
  const body = { ...good, wallet: 'apple_pay', token: WALLET_TOKEN, card: { network: 'Visa', displayName: 'Visa 1234', type: 'credit' } }
  function postWallet(key?: string) {
    const req = jsonRequest('http://x/api/payments/wallet/charge', body)
    if (key) req.headers.set('Idempotency-Key', key)
    return walletCharge(req as never)
  }

  it('the same key twice is one Stitch call and the same bet', async () => {
    asUser(USER_A); seed({ card: false })
    const f = stitchFetch(); vi.stubGlobal('fetch', f)
    const first = await postWallet(KEY)
    expect(first.status).toBe(200)
    const a = await first.json()
    const second = await postWallet(KEY)
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ betId: a.betId, m_payment_id: a.m_payment_id, replayed: true })
    expect(f.graphql()).toBe(1)
    expect(db.rows('payfast_payments')).toHaveLength(1)
    expect(db.rows('payfast_payments')[0]).toMatchObject({ provider: 'stitch', idempotency_key: KEY })
  })

  it('a twin that landed first with the same key is replayed; this request writes nothing', async () => {
    asUser(USER_A); seed({ card: false })
    const f = stitchFetch(); vi.stubGlobal('fetch', f)
    db.beforeInsert = table => {
      if (table !== 'payfast_payments') return
      db.beforeInsert = null
      db.seed('payfast_payments', { m_payment_id: 'gl_twin', user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', amount_cents: 5000, status: 'pending', provider: 'stitch', idempotency_key: KEY, raw_payload: { source: 'wallet' } })
    }
    const res = await postWallet(KEY)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'CHARGE_UNKNOWN', m_payment_id: 'gl_twin', replayed: true })
    expect(f.graphql()).toBe(0)
    expect(db.rows('payfast_payments')).toHaveLength(1)
  })
})

describe('the free swing says which bet it already made', () => {
  it('409 FREE_SWING_USED carries betId and status, so a lost answer still leads to the recorder', async () => {
    asUser(USER_A); seed({ card: false })
    const req = () => freeSwing(jsonRequest('http://x/api/bets/free', { courseId: COURSE_ID, holeId: HOLE_ID }) as never)
    const first = await req()
    expect(first.status).toBe(200)
    const { betId } = await first.json()
    const again = await req()
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ code: 'FREE_SWING_USED', betId, status: 'active' })
  })
})

describe('the play gate', () => {
  it('counts the user and the IP in one round, and the user limit still refuses', async () => {
    const calls: string[] = []
    const admin = createFakeClient(db)
    const rpc = admin.rpc.bind(admin)
    admin.rpc = ((name: string, args: Record<string, unknown>) => { calls.push(String(args.p_key)); return rpc(name, args) }) as typeof admin.rpc
    adminClient.createAdminClient.mockImplementation(() => admin)
    for (let i = 0; i < RULES.freeSwing.perUser; i++) expect(await enforceRateLimit(RULES.freeSwing, { userId: USER_A.id, ip: '1.2.3.4' })).toBeNull()
    const limited = await enforceRateLimit(RULES.freeSwing, { userId: USER_A.id, ip: '1.2.3.4' })
    expect(limited?.status).toBe(429)
    expect(calls.filter(k => k.startsWith('free_swing:user:'))).toHaveLength(RULES.freeSwing.perUser + 1)
    expect(calls.filter(k => k.startsWith('free_swing:ip:'))).toHaveLength(RULES.freeSwing.perUser + 1)
  })
})
