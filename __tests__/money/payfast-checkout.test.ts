/**
 * POST /api/payments/payfast — the checkout signer.
 *
 * Money invariants pinned here:
 *  - no session, no checkout
 *  - the amount is chosen server-side from the tier, never from the body
 *  - user, course, hole and tier ride inside the signed payload (custom_str1..4)
 *  - the signature is the PayFast MD5 over the ordered fields plus passphrase
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { FakeDb, createFakeClient, jsonRequest, USER_A, COURSE_ID, HOLE_ID, type FakeUser } from '../helpers/fake-supabase'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)

async function loadRoute(env: Record<string, string> = {}) {
  vi.resetModules()
  vi.stubEnv('PAYFAST_MERCHANT_ID', '10000100')
  vi.stubEnv('PAYFAST_MERCHANT_KEY', '46f0cd694581a')
  vi.stubEnv('PAYFAST_PASSPHRASE', 'unit-test-passphrase')
  vi.stubEnv('PAYFAST_SANDBOX', 'true')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.example.com')
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  return import('@/app/api/payments/payfast/route')
}

function asUser(user: FakeUser | null) {
  serverClient.createClient.mockResolvedValue(createFakeClient(new FakeDb(), { user }))
}

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

describe('POST /api/payments/payfast', () => {
  beforeEach(() => { vi.unstubAllEnvs(); serverClient.createClient.mockReset() })

  it('refuses without a session', async () => {
    const { POST } = await loadRoute()
    asUser(null)
    const res = await POST(jsonRequest('http://x/api/payments/payfast', { tier: 'tier_1', courseId: COURSE_ID, holeId: HOLE_ID }) as never)
    expect(res.status).toBe(401)
  })

  it('refuses an unknown tier and a missing course/hole', async () => {
    const { POST } = await loadRoute()
    asUser(USER_A)
    const noTier = await POST(jsonRequest('http://x', { tier: 'tier_9', courseId: COURSE_ID, holeId: HOLE_ID }) as never)
    expect(noTier.status).toBe(400)
    const noHole = await POST(jsonRequest('http://x', { tier: 'tier_1', courseId: COURSE_ID }) as never)
    expect(noHole.status).toBe(400)
  })

  it.each([
    ['tier_1', '50.00'], ['tier_2', '100.00'], ['tier_6', '150.00'],
    ['tier_3', '250.00'], ['tier_4', '500.00'], ['tier_5', '1000.00'],
  ])('prices %s at R%s server-side regardless of what the body says', async (tier, amount) => {
    const { POST } = await loadRoute()
    asUser(USER_A)
    const res = await POST(jsonRequest('http://x', { tier, courseId: COURSE_ID, holeId: HOLE_ID, amount: '0.01' }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.formFields.amount).toBe(amount)
    expect(body.formFields.currency).toBe('ZAR')
  })

  it('binds user, course, hole and tier into the signed payload', async () => {
    const { POST } = await loadRoute()
    asUser(USER_A)
    const res = await POST(jsonRequest('http://x', { tier: 'tier_2', courseId: COURSE_ID, holeId: HOLE_ID, userName: 'Alice Ace' }) as never)
    const { formFields, m_payment_id, redirectUrl, sandbox } = await res.json()

    expect(formFields.custom_str1).toBe(USER_A.id)
    expect(formFields.custom_str2).toBe(COURSE_ID)
    expect(formFields.custom_str3).toBe(HOLE_ID)
    expect(formFields.custom_str4).toBe('tier_2')
    expect(formFields.m_payment_id).toBe(m_payment_id)
    expect(formFields.notify_url).toBe('https://preview.example.com/api/payments/payfast/notify')
    expect(formFields.return_url).toBe('https://preview.example.com/payment-return')
    expect(sandbox).toBe(true)
    expect(redirectUrl).toContain('sandbox.payfast.co.za')

    // The signature must match PayFast's published algorithm, computed independently here.
    const { signature, ...fields } = formFields
    expect(signature).toBe(payfastSignature(fields, 'unit-test-passphrase'))
  })

  it('uses the live checkout host only when PAYFAST_SANDBOX is exactly "false"', async () => {
    asUser(USER_A)
    for (const [value, expectSandbox] of [['false', false], ['False', true], ['0', true], ['', true]] as const) {
      const { POST } = await loadRoute({ PAYFAST_SANDBOX: value })
      const res = await POST(jsonRequest('http://x', { tier: 'tier_1', courseId: COURSE_ID, holeId: HOLE_ID }) as never)
      const body = await res.json()
      expect(body.sandbox, `PAYFAST_SANDBOX=${JSON.stringify(value)}`).toBe(expectSandbox)
    }
  })

  it('strips characters that would break the PayFast form from the name', async () => {
    const { POST } = await loadRoute()
    asUser(USER_A)
    const res = await POST(jsonRequest('http://x', { tier: 'tier_1', courseId: COURSE_ID, holeId: HOLE_ID, userName: '<script>"Bob" & Co</script>' }) as never)
    const { formFields } = await res.json()
    expect(formFields.name_first).not.toMatch(/[<>"'&]/)
    expect(formFields.name_last).not.toMatch(/[<>"'&]/)
  })
})
