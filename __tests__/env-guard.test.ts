/**
 * The start-up environment guard: a preview deployment must never talk to
 * the production database or take real money.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureRequestError: vi.fn(),
}))

import { guardEnvironment } from '@/instrumentation'

const PROD_URL = 'https://ajsgzeofswlizwwdkesp.supabase.co'
const STAGING_URL = 'https://stagingref000000000.supabase.co'

describe('guardEnvironment', () => {
  it('refuses a preview pointed at the production Supabase project', () => {
    expect(() => guardEnvironment({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: PROD_URL, PAYFAST_SANDBOX: 'true' }))
      .toThrow(/PRODUCTION Supabase project/)
  })

  it('refuses a preview with PayFast in live mode', () => {
    expect(() => guardEnvironment({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, PAYFAST_SANDBOX: 'false' }))
      .toThrow(/real money/)
  })

  it('allows a preview on staging in sandbox', () => {
    expect(() => guardEnvironment({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, PAYFAST_SANDBOX: 'true' })).not.toThrow()
    expect(() => guardEnvironment({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: STAGING_URL })).not.toThrow()
  })

  it('allows production against production in live mode', () => {
    expect(() => guardEnvironment({ VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: PROD_URL, PAYFAST_SANDBOX: 'false' })).not.toThrow()
  })

  it('refuses production in sandbox mode, and reports it', async () => {
    const Sentry = await import('@sentry/nextjs')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const value of ['true', 'False', '0', undefined]) {
      expect(() => guardEnvironment({ VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: PROD_URL, PAYFAST_SANDBOX: value }), String(value)).toThrow(/SANDBOX/)
    }
    expect(Sentry.captureMessage).toHaveBeenCalledWith(expect.stringMatching(/SANDBOX/), 'fatal')
    spy.mockRestore()
  })

  it('does nothing outside Vercel (local dev, CI)', () => {
    expect(() => guardEnvironment({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL })).not.toThrow()
  })
})
