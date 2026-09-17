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
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

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

function seedTarget(over: { active?: boolean; partner?: boolean; par?: number; metres?: number | null } = {}) {
  db.seed('courses', { id: COURSE_ID, name: 'Leopard Creek', is_partner: over.partner ?? true }, { id: OTHER_COURSE, name: 'Elsewhere', is_partner: true })
  db.seed('holes', {
    id: HOLE_ID, course_id: COURSE_ID, hole_number: 4, is_active: over.active ?? true,
    par: over.par ?? 3, distance_metres: over.metres === undefined ? 165 : over.metres,
  })
}

const checkout = (body: unknown, init: RequestInit = {}) => POST(jsonRequest('http://x/api/payments/payfast', body, init) as never)
const good = { tier: 'tier_1', courseId: COURSE_ID, holeId: HOLE_ID }

const PF_ORDER = [
  'merchant_id', 'merchant_key', 'return_url', 'cancel_url', 'notify_url',
  'name_first', 'name_last', 'email_address', 'cell_number',
  'm_payment_id', 'amount', 'item_name', 'item_description',
  'custom_int1', 'custom_int2', 'custom_int3', 'custom_int4', 'custom_int5',
  'custom_str1', 'custom_str2', 'custom_str3', 'custom_str4', 'custom_str5',
  'email_confirmation', 'confirmation_address', 'currency', 'payment_method',
  'subscription_type', 'billing_date', 'recurring_amount', 'frequency', 'cycles',
  'subscription_notify_email', 'subscription_notify_webhook', 'subscription_notify_buyer',
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
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  // PayFast's Onsite endpoint is off the network here; the checkout must still work without it.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

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

  it('400 HOLE_NOT_ELIGIBLE for a par 3 shorter than 140m, a par 4, or a hole with no distance', async () => {
    asUser(USER_A); seedTarget({ metres: 139 })
    const short = await (await checkout(good)).json()
    expect(short.code).toBe('HOLE_NOT_ELIGIBLE')
    expect(short.error).toContain('140m')
    seedTarget({ par: 4, metres: 320 })
    expect((await (await checkout(good)).json()).code).toBe('HOLE_NOT_ELIGIBLE')
    seedTarget({ metres: null })
    expect((await (await checkout(good)).json()).code).toBe('HOLE_NOT_ELIGIBLE')
  })

  it('accepts a par 3 of exactly 140m', async () => {
    asUser(USER_A); seedTarget({ metres: 140 })
    const res = await checkout(good)
    expect(res.status).toBe(200)
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
    expect(formFields.return_url).toBe(`https://preview.example.com/payment-return?ref=${formFields.m_payment_id}`)
    expect(sandbox).toBe(true)
    expect(redirectUrl).toBe('https://sandbox.payfast.co.za/eng/process')

    const { signature, ...fields } = formFields
    expect(signature).toBe(payfastSignature(fields, 'unit-test-passphrase'))
  })

  it('asks PayFast to tokenize the card only when the golfer said so, and signs it in', async () => {
    asUser(USER_A); seedTarget()
    const plain = await (await checkout(good)).json()
    expect(plain.formFields.subscription_type).toBeUndefined()

    const saving = await (await checkout({ ...good, saveCard: true })).json()
    expect(saving.formFields.subscription_type).toBe('2')
    const { signature, ...fields } = saving.formFields
    expect(signature).toBe(payfastSignature(fields, 'unit-test-passphrase'))
  })

  it('sends the golfer back to the host they are on, never to a stranger\'s', async () => {
    asUser(USER_A); seedTarget()
    const onWww = await checkout(good, { headers: { host: 'www.getluckyholeinone.com', 'x-forwarded-proto': 'https' } })
    const { formFields: a } = await onWww.json()
    expect(a.return_url).toBe(`https://www.getluckyholeinone.com/payment-return?ref=${a.m_payment_id}`)
    expect(a.cancel_url).toBe('https://www.getluckyholeinone.com/choose-stake')
    expect(a.notify_url).toBe('https://preview.example.com/api/payments/payfast/notify')

    const onAlias = await checkout(good, { headers: { 'x-forwarded-host': 'get-lucky-golf.vercel.app' } })
    const { formFields: b } = await onAlias.json()
    expect(b.return_url).toBe(`https://get-lucky-golf.vercel.app/payment-return?ref=${b.m_payment_id}`)

    const spoofed = await checkout(good, { headers: { host: 'evil.example.net' } })
    const { formFields: c } = await spoofed.json()
    expect(c.return_url).toBe(`https://preview.example.com/payment-return?ref=${c.m_payment_id}`)
  })

  it('returns an Onsite identifier when PayFast issues one, posting the signed fields with the signature last', async () => {
    asUser(USER_A); seedTarget()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ uuid: 'abc-123' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await checkout(good)
    const { onsite, formFields } = await res.json()
    expect(onsite).toEqual({ uuid: 'abc-123', engineUrl: 'https://sandbox.payfast.co.za/onsite/engine.js' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://sandbox.payfast.co.za/onsite/process')
    expect(String(init.body)).toMatch(new RegExp(`^merchant_id=10012345&.*&signature=${formFields.signature}$`))
  })

  it('still answers the hosted-page fields when Onsite fails or is switched off', async () => {
    asUser(USER_A); seedTarget()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const failed = await (await checkout(good)).json()
    expect(failed.onsite).toBeNull()
    expect(failed.redirectUrl).toBe('https://sandbox.payfast.co.za/eng/process')

    env({ PAYFAST_ONSITE: 'off' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const off = await (await checkout(good)).json()
    expect(off.onsite).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('429 RATE_LIMITED after ten checkouts in ten minutes for one user', async () => {
    asUser(USER_A); seedTarget()
    for (let i = 0; i < 10; i++) expect((await checkout(good)).status, `checkout ${i + 1}`).toBe(200)
    const eleventh = await checkout(good)
    expect(eleventh.status).toBe(429)
    expect((await eleventh.json()).code).toBe('RATE_LIMITED')
    expect(Number(eleventh.headers.get('retry-after'))).toBeGreaterThan(0)
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
