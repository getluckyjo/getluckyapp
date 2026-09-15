/**
 * POST /api/payments/payfast — the checkout signer.
 *
 * Money invariants pinned here:
 *  - no session, no checkout; no credentials, no checkout; production in
 *    sandbox, no checkout
 *  - the amount is chosen server-side from the tier, never from the body
 *  - the target must be an active hole at a partner course, and belong to it
 *  - user, course, hole and tier ride inside the signed payload (custom_str1..4)
 *  - the signature is the PayFast MD5 over the ordered fields plus passphrase
 *  - the reference is unguessable and unique
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { FakeDb, createFakeClient, jsonRequest, USER_A, COURSE_ID, HOLE_ID, type FakeUser } from '../helpers/fake-supabase'
import { POST } from '@/app/api/payments/payfast/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)

const OTHER_COURSE = '55555555-5555-4555-8555-555555555555'
let db: FakeDb

function env(over: Record<string, string | undefined> = {}) {
  vi.unstubAllEnvs()
  const base: Record<string, string | undefined> = {
    PAYFAST_MERCHANT_ID: '10012345',
    PAYFAST_MERCHANT_KEY: 'sandboxkey123',
    PAYFAST_PASSPHRASE: 'unit-test-passphrase',
    PAYFAST_SANDBOX: 'true',
    NEXT_PUBLIC_SITE_URL: 'https://preview.example.com',
    VERCEL_ENV: 'preview',
    ...over,
  }
  for (const [k, v] of Object.entries(base)) if (v !== undefined) vi.stubEnv(k, v)
}

function asUser(user: FakeUser | null) {
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user }))
}

function seedTarget(over: { active?: boolean; partner?: boolean } = {}) {
  db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek', is_partner: over.partner ?? true }, { id: OTHER_COURSE, name: 'Elsewhere', is_partner: true })
  db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 4, is_active: over.active ?? true })
}

const checkout = (body: unknown) => POST(jsonRequest('http://x/api/payments/payfast', body) as never)
const good = { tier: 'tier_1', courseId: COURSE_ID, holeId: HOLE_ID }

const PF_ORDER = [
  'merchant_id', 'merchant_key', 'return_url', 'cancel_url', 'notify_url',
  'name_first', 'name_last', 'email_address', 'cell_number',
  'm_payment_id', 'amount', 'item_name', 'item_description',
  'custom_int1', 'custom_int2', 'custom_int3', 'custom_int4', 'custom_int5',
  'custom_str1', 'custom_str2', 'custom_str3', 'custom_str4', 'custom_str5',
  'email_confirmation', 'confirmation_address', 'currency', 'payment_method',
]

/** Independent implementation of PayFast's signature spec, so the route is checked against the spec and not itself. */
function payfastSignature(fields: Record<string, string>, passphrase: string) {
  const enc = (v: string) => encodeURIComponent(v.trim()).replace(/%20/g, '+')
  const qs = PF_ORDER.filter(k => fields[k] !== undefined && fields[k] !== '').map(k => `${k}=${enc(fields[k])}`).join('&')
  return createHash('md5').update(`${qs}&passphrase=${enc(passphrase)}`).digest('hex')
}

beforeEach(() => {
  db = new FakeDb()
  env()
  serverClient.createClient.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('configuration gate', () => {
  it('503 PAYMENTS_UNAVAILABLE when merchant credentials are missing: no built-in fallback', async () => {
    env({ PAYFAST_MERCHANT_ID: undefined, PAYFAST_MERCHANT_KEY: undefined })
    asUser(USER_A); seedTarget()
    const res = await checkout(good)
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('PAYMENTS_UNAVAILABLE')
  })

  it('503 in production unless PAYFAST_SANDBOX is exactly "false" with a passphrase and site URL', async () => {
    asUser(USER_A); seedTarget()
    for (const bad of [{ PAYFAST_SANDBOX: 'true' }, { PAYFAST_SANDBOX: 'False' }, { PAYFAST_SANDBOX: undefined }, { PAYFAST_SANDBOX: 'false', PAYFAST_PASSPHRASE: '' }, { PAYFAST_SANDBOX: 'false', NEXT_PUBLIC_SITE_URL: undefined }]) {
      env({ VERCEL_ENV: 'production', ...bad })
      expect((await checkout(good)).status, JSON.stringify(bad)).toBe(503)
    }
    env({ VERCEL_ENV: 'production', PAYFAST_SANDBOX: 'false' })
    const live = await checkout(good)
    expect(live.status).toBe(200)
    const body = await live.json()
    expect(body.sandbox).toBe(false)
    expect(body.redirectUrl).toBe('https://www.payfast.co.za/eng/process')
  })

  it('refuses live mode with the shared sandbox merchant id', async () => {
    env({ VERCEL_ENV: 'production', PAYFAST_SANDBOX: 'false', PAYFAST_MERCHANT_ID: '10000100' })
    asUser(USER_A); seedTarget()
    expect((await checkout(good)).status).toBe(503)
  })
})

describe('request gates', () => {
  it('refuses without a session', async () => {
    asUser(null)
    expect((await checkout(good)).status).toBe(401)
  })

  it('403 ACCOUNT_SUSPENDED for a suspended account', async () => {
    db.seed('profiles', { id: USER_A.id, suspended_at: '2026-09-01T00:00:00Z' })
    asUser(USER_A); seedTarget()
    const res = await checkout(good)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ACCOUNT_SUSPENDED')
  })

  it('400 on an unknown tier, a missing or non-UUID course/hole', async () => {
    asUser(USER_A); seedTarget()
    expect((await checkout({ ...good, tier: 'tier_9' })).status).toBe(400)
    expect((await checkout({ tier: 'tier_1', courseId: COURSE_ID })).status).toBe(400)
    expect((await checkout({ tier: 'tier_1', courseId: 'sa-top100-001', holeId: 'sa-top100-001-h4' })).status).toBe(400)
  })

  it('400 HOLE_INVALID when the hole does not exist or belongs to a different course', async () => {
    asUser(USER_A); seedTarget()
    const missing = await checkout({ ...good, holeId: '66666666-6666-4666-8666-666666666666' })
    expect((await missing.json()).code).toBe('HOLE_INVALID')
    const wrongCourse = await checkout({ ...good, courseId: OTHER_COURSE })
    expect((await wrongCourse.json()).code).toBe('HOLE_INVALID')
  })

  it('400 HOLE_INACTIVE for a hole that is switched off', async () => {
    asUser(USER_A); seedTarget({ active: false })
    expect((await (await checkout(good)).json()).code).toBe('HOLE_INACTIVE')
  })

  it('400 COURSE_NOT_PARTNER for a course without an agreement', async () => {
    asUser(USER_A); seedTarget({ partner: false })
    expect((await (await checkout(good)).json()).code).toBe('COURSE_NOT_PARTNER')
  })
})

describe('the signed checkout', () => {
  it.each([
    ['tier_1', '50.00'], ['tier_2', '100.00'], ['tier_6', '150.00'],
    ['tier_3', '250.00'], ['tier_4', '500.00'], ['tier_5', '1000.00'],
  ])('prices %s at R%s server-side regardless of what the body says', async (tier, amount) => {
    asUser(USER_A); seedTarget()
    const res = await checkout({ ...good, tier, amount: '0.01' })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.formFields.amount).toBe(amount)
    expect(body.formFields.currency).toBe('ZAR')
  })

  it('binds user, course, hole and tier into the signed payload and signs per PayFast\'s spec', async () => {
    asUser(USER_A); seedTarget()
    const res = await checkout({ ...good, tier: 'tier_2', userName: 'Alice Ace' })
    const { formFields, m_payment_id, redirectUrl, sandbox } = await res.json()

    expect(formFields.merchant_id).toBe('10012345')
    expect(formFields.custom_str1).toBe(USER_A.id)
    expect(formFields.custom_str2).toBe(COURSE_ID)
    expect(formFields.custom_str3).toBe(HOLE_ID)
    expect(formFields.custom_str4).toBe('tier_2')
    expect(formFields.m_payment_id).toBe(m_payment_id)
    expect(formFields.notify_url).toBe('https://preview.example.com/api/payments/payfast/notify')
    expect(formFields.return_url).toBe('https://preview.example.com/payment-return')
    expect(sandbox).toBe(true)
    expect(redirectUrl).toBe('https://sandbox.payfast.co.za/eng/process')

    const { signature, ...fields } = formFields
    expect(signature).toBe(payfastSignature(fields, 'unit-test-passphrase'))
  })

  it('issues an unguessable, unique reference per checkout', async () => {
    asUser(USER_A); seedTarget()
    const ids = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const { m_payment_id } = await (await checkout(good)).json()
      expect(m_payment_id).toMatch(/^gl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      ids.add(m_payment_id)
    }
    expect(ids.size).toBe(5)
  })

  it('strips characters that would break the PayFast form from the name', async () => {
    asUser(USER_A); seedTarget()
    const res = await checkout({ ...good, userName: '<script>"Bob" & Co</script>' })
    const { formFields } = await res.json()
    expect(formFields.name_first).not.toMatch(/[<>"'&]/)
    expect(formFields.name_last).not.toMatch(/[<>"'&]/)
  })
})
