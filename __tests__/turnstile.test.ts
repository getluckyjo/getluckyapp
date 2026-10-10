/**
 * Cloudflare Turnstile on sign-in (src/lib/auth/turnstile.ts): on only
 * when its site key is set, and the token reaches Supabase's sign-in
 * options only when there is one.
 */
import { describe, it, expect } from 'vitest'
import { TURNSTILE_SCRIPT_URL, captchaOptions, turnstileSiteKey } from '@/lib/auth/turnstile'

describe('Turnstile', () => {
  it('is off without the site key, and on with one', () => {
    expect(turnstileSiteKey({})).toBeNull()
    expect(turnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: '' })).toBeNull()
    expect(turnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: '  ' })).toBeNull()
    expect(turnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' })).toBe('1x00000000000000000000AA')
  })

  it('adds captchaToken to the sign-in options only when there is a token', () => {
    expect(captchaOptions(null)).toEqual({})
    expect(captchaOptions(undefined)).toEqual({})
    expect(captchaOptions('')).toEqual({})
    expect(captchaOptions('tok_123')).toEqual({ captchaToken: 'tok_123' })
    expect({ emailRedirectTo: 'https://x/auth/callback', ...captchaOptions(null) }).toEqual({ emailRedirectTo: 'https://x/auth/callback' })
  })

  it('loads the script from Cloudflare', () => {
    expect(TURNSTILE_SCRIPT_URL).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js')
  })
})
