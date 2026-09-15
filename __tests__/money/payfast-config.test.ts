/**
 * PayFast configuration resolution: the rules that decide whether money can
 * move at all in a given environment.
 */
import { describe, it, expect } from 'vitest'
import { resolvePayfastConfig } from '@/lib/payfast/config'

const LIVE = {
  VERCEL_ENV: 'production',
  PAYFAST_MERCHANT_ID: '10012345',
  PAYFAST_MERCHANT_KEY: 'livekey',
  PAYFAST_PASSPHRASE: 'a-real-passphrase',
  PAYFAST_SANDBOX: 'false',
  NEXT_PUBLIC_SITE_URL: 'https://www.getluckyholeinone.com/',
}

describe('resolvePayfastConfig', () => {
  it('accepts a complete live production configuration', () => {
    const r = resolvePayfastConfig(LIVE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.sandbox).toBe(false)
    expect(r.config.processUrl).toBe('https://www.payfast.co.za/eng/process')
    expect(r.config.validateUrl).toBe('https://www.payfast.co.za/eng/query/validate')
    expect(r.config.siteUrl).toBe('https://www.getluckyholeinone.com')
  })

  it('refuses production in sandbox for every value of PAYFAST_SANDBOX other than "false"', () => {
    for (const v of ['true', 'False', 'FALSE', '0', 'no', '', undefined]) {
      const r = resolvePayfastConfig({ ...LIVE, PAYFAST_SANDBOX: v })
      expect(r.ok, String(v)).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/PAYFAST_SANDBOX/)
    }
  })

  it('refuses production without a passphrase or site URL', () => {
    expect(resolvePayfastConfig({ ...LIVE, PAYFAST_PASSPHRASE: '' }).ok).toBe(false)
    expect(resolvePayfastConfig({ ...LIVE, NEXT_PUBLIC_SITE_URL: undefined }).ok).toBe(false)
  })

  it('never falls back to PayFast\'s shared sandbox credentials', () => {
    const r = resolvePayfastConfig({ VERCEL_ENV: 'preview' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/PAYFAST_MERCHANT_ID/)
    const live = resolvePayfastConfig({ ...LIVE, PAYFAST_MERCHANT_ID: '10000100' })
    expect(live.ok).toBe(false)
    if (!live.ok) expect(live.reason).toMatch(/shared sandbox merchant/)
  })

  it('previews and local dev default to sandbox and localhost, with their own sandbox credentials', () => {
    const r = resolvePayfastConfig({ PAYFAST_MERCHANT_ID: '10012345', PAYFAST_MERCHANT_KEY: 'sandboxkey' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.sandbox).toBe(true)
    expect(r.config.siteUrl).toBe('http://localhost:3000')
    expect(r.config.processUrl).toBe('https://sandbox.payfast.co.za/eng/process')
    expect(r.config.passphrase).toBe('')
  })
})
