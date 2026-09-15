/**
 * POST /api/payments/payfast/notify — the PayFast ITN webhook.
 *
 * This is the only writer of the payments ledger, and the ledger is the only
 * thing that lets a bet exist. Everything here is about making sure money
 * cannot be faked, cannot be lost silently, and cannot count twice.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { FakeDb, createFakeClient, formRequest, USER_A, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'

const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => adminClient)

const PASSPHRASE = 'unit-test-passphrase'
const MERCHANT_ID = '10012345'

async function loadRoute(env: Record<string, string> = {}) {
  vi.unstubAllEnvs()
  vi.stubEnv('PAYFAST_MERCHANT_ID', MERCHANT_ID)
  vi.stubEnv('PAYFAST_MERCHANT_KEY', 'sandboxkey123')
  vi.stubEnv('PAYFAST_PASSPHRASE', PASSPHRASE)
  vi.stubEnv('PAYFAST_SANDBOX', 'true')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.example.com')
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return import('@/app/api/payments/payfast/notify/route')
}

/** PayFast signs the ITN over every posted field, in the order posted, then the passphrase. */
function sign(fields: Record<string, string>, passphrase = PASSPHRASE) {
  const enc = (v: string) => encodeURIComponent(v.trim()).replace(/%20/g, '+')
  const qs = Object.entries(fields).map(([k, v]) => `${k}=${enc(v)}`).join('&')
  return createHash('md5').update(`${qs}&passphrase=${enc(passphrase)}`).digest('hex')
}

function itn(overrides: Record<string, string> = {}, opts: { sign?: boolean; passphrase?: string } = {}) {
  const fields: Record<string, string> = {
    m_payment_id: 'gl_tier_1_1700000000000',
    pf_payment_id: '1089250',
    payment_status: 'COMPLETE',
    item_name: 'Get Lucky Golf - R50 Entry',
    amount_gross: '50.00',
    amount_fee: '-2.30',
    amount_net: '47.70',
    custom_str1: USER_A.id,
    custom_str2: COURSE_ID,
    custom_str3: HOLE_ID,
    custom_str4: 'tier_1',
    name_first: 'Alice',
    name_last: 'Ace',
    email_address: 'payments@getluckygolf.co.za',
    merchant_id: MERCHANT_ID,
    ...overrides,
  }
  if (opts.sign !== false) fields.signature = sign(fields, opts.passphrase)
  return fields
}

let db: FakeDb
let validateResponse: string

beforeEach(() => {
  db = new FakeDb()
  adminClient.createAdminClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  validateResponse = 'VALID'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(validateResponse)))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const post = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
  formRequest('http://x/api/payments/payfast/notify', fields, headers)

describe('ITN authentication', () => {
  it('rejects a payload with a bad signature and writes nothing', async () => {
    const { POST } = await loadRoute()
    const res = await POST(post(itn({}, { passphrase: 'wrong' })) as never)
    expect(res.status).toBe(400)
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })

  it('rejects when PayFast says the ITN is not genuine', async () => {
    const { POST } = await loadRoute()
    validateResponse = 'INVALID'
    const res = await POST(post(itn()) as never)
    expect(res.status).toBe(400)
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })

  it('fails closed when the validate endpoint is unreachable', async () => {
    const { POST } = await loadRoute()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    const res = await POST(post(itn()) as never)
    expect(res.status).toBe(400)
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })

  it('fails closed when the validate endpoint hangs: aborts after the timeout', async () => {
    vi.useFakeTimers()
    try {
      const { POST } = await loadRoute()
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')))
      })))
      const pending = POST(post(itn()) as never)
      await vi.advanceTimersByTimeAsync(10_001)
      const res = await pending
      expect(res.status).toBe(400)
      expect(db.rows('payfast_payments')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('503 when PayFast is misconfigured (no credentials), touching nothing', async () => {
    const { POST } = await loadRoute()
    vi.stubEnv('PAYFAST_MERCHANT_ID', '')
    const res = await POST(post(itn()) as never)
    expect(res.status).toBe(503)
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })

  it('503 in production while still in sandbox mode', async () => {
    const { POST } = await loadRoute({ VERCEL_ENV: 'production' })
    const res = await POST(post(itn()) as never)
    expect(res.status).toBe(503)
  })

  it('rejects a merchant id that is not ours', async () => {
    const { POST } = await loadRoute()
    const res = await POST(post(itn({ merchant_id: '99999999' })) as never)
    expect(res.status).toBe(400)
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })

  it('in live mode, drops notifications that do not come from a PayFast address', async () => {
    const { POST } = await loadRoute({ PAYFAST_SANDBOX: 'false' })
    const fromElsewhere = await POST(post(itn(), { 'x-forwarded-for': '203.0.113.10' }) as never)
    expect(fromElsewhere.status).toBe(403)

    const fromPayfast = await POST(post(itn(), { 'x-forwarded-for': '197.97.145.150, 76.76.21.21' }) as never)
    expect(fromPayfast.status).toBe(200)
    expect(db.rows('payfast_payments')).toHaveLength(1)
  })

  it('in sandbox, does not enforce the IP allow-list', async () => {
    const { POST } = await loadRoute()
    const res = await POST(post(itn(), { 'x-forwarded-for': '203.0.113.10' }) as never)
    expect(res.status).toBe(200)
  })
})

describe('ledger writes', () => {
  it('records a COMPLETE payment with the tier, user, course and hole from the signed payload', async () => {
    const { POST } = await loadRoute()
    const res = await POST(post(itn()) as never)
    expect(res.status).toBe(200)

    const [row] = db.rows('payfast_payments')
    expect(row).toMatchObject({
      m_payment_id: 'gl_tier_1_1700000000000',
      pf_payment_id: '1089250',
      user_id: USER_A.id,
      course_id: COURSE_ID,
      hole_id: HOLE_ID,
      tier: 'tier_1',
      amount_cents: 5000,
      status: 'complete',
    })
    expect(row.raw_payload).toMatchObject({ payment_status: 'COMPLETE' })
  })

  it('does not write the ledger for a non-COMPLETE status', async () => {
    const { POST } = await loadRoute()
    for (const status of ['FAILED', 'CANCELLED', 'PENDING']) {
      const res = await POST(post(itn({ payment_status: status })) as never)
      expect(res.status).toBe(200)
    }
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })

  it('records an amount that does not match the tier as amount_mismatch with no tier', async () => {
    const { POST } = await loadRoute()
    // Someone paid R50 but the signed tier says R1,000.
    const res = await POST(post(itn({ custom_str4: 'tier_5', amount_gross: '50.00' })) as never)
    expect(res.status).toBe(200)
    const [row] = db.rows('payfast_payments')
    expect(row.status).toBe('amount_mismatch')
    expect(row.tier).toBeNull()
    expect(row.amount_cents).toBe(5000)
  })

  it('records an unknown tier as amount_mismatch', async () => {
    const { POST } = await loadRoute()
    await POST(post(itn({ custom_str4: 'tier_99' })) as never)
    expect(db.rows('payfast_payments')[0].status).toBe('amount_mismatch')
  })

  it('compares amounts in integer cents, so "50.00" and "50" and "50.004" all match R50', async () => {
    const { POST } = await loadRoute()
    for (const amount of ['50.00', '50', '50.004']) {
      db = new FakeDb()
      adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
      await POST(post(itn({ amount_gross: amount })) as never)
      expect(db.rows('payfast_payments')[0].status, `amount_gross=${amount}`).toBe('complete')
    }
  })

  it('is idempotent: the same ITN delivered twice leaves one ledger row', async () => {
    const { POST } = await loadRoute()
    await POST(post(itn()) as never)
    await POST(post(itn()) as never)
    expect(db.rows('payfast_payments')).toHaveLength(1)
  })

  it('returns 500 when the ledger cannot be written so PayFast retries', async () => {
    const { POST } = await loadRoute()
    adminClient.createAdminClient.mockImplementation(() =>
      createFakeClient(db, { failTable: { payfast_payments: { code: '42P01', message: 'relation "payfast_payments" does not exist' } } }),
    )
    const res = await POST(post(itn()) as never)
    expect(res.status).toBe(500)
  })

  it('returns 500 when the service role key is missing', async () => {
    const { POST } = await loadRoute()
    adminClient.createAdminClient.mockImplementation(() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set') })
    const res = await POST(post(itn()) as never)
    expect(res.status).toBe(500)
  })

  it('attaches PayFast\'s id to an existing bet without rewriting our reference or touching status', async () => {
    const { POST } = await loadRoute()
    const [bet] = db.seed('bets', { user_id: USER_A.id, payment_intent_id: 'gl_tier_1_1700000000000', pf_payment_id: null, status: 'miss' })
    await POST(post(itn()) as never)
    expect(bet.payment_intent_id).toBe('gl_tier_1_1700000000000')
    expect(bet.pf_payment_id).toBe('1089250')
    expect(bet.status).toBe('miss')
  })

  it('answers 500 on an unexpected failure after validation so PayFast retries', async () => {
    const { POST } = await loadRoute()
    adminClient.createAdminClient.mockImplementation(() => {
      const c = createFakeClient(db)
      c.from = (() => { throw new TypeError('boom') }) as typeof c.from
      return c
    })
    const res = await POST(post(itn()) as never)
    expect(res.status).toBe(500)
  })

  it('ignores a COMPLETE payment with no m_payment_id rather than crashing', async () => {
    const { POST } = await loadRoute()
    const res = await POST(post(itn({ m_payment_id: '' })) as never)
    expect(res.status).toBe(200)
    expect(db.rows('payfast_payments')).toHaveLength(0)
  })
})
