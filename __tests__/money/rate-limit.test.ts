/**
 * The rate limiter: per-user and per-IP fixed windows counted in Postgres,
 * failing open when the counter cannot be reached.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient } from '../helpers/fake-supabase'
import { enforceRateLimit, clientIp, RULES, type RateRule } from '@/lib/rate-limit'

const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb
const RULE: RateRule = { name: 'test', perUser: 3, perIp: 6, windowSeconds: 60 }

beforeEach(() => {
  db = new FakeDb()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('enforceRateLimit', () => {
  it('allows up to the per-user limit, then 429 with Retry-After', async () => {
    for (let i = 0; i < 3; i++) expect(await enforceRateLimit(RULE, { userId: 'u1' })).toBeNull()
    const res = await enforceRateLimit(RULE, { userId: 'u1' })
    expect(res?.status).toBe(429)
    expect((await res!.json()).code).toBe('RATE_LIMITED')
    const retry = Number(res!.headers.get('retry-after'))
    expect(retry).toBeGreaterThan(0)
    expect(retry).toBeLessThanOrEqual(60)
  })

  it('counts users independently', async () => {
    for (let i = 0; i < 3; i++) await enforceRateLimit(RULE, { userId: 'u1' })
    expect(await enforceRateLimit(RULE, { userId: 'u1' })).not.toBeNull()
    expect(await enforceRateLimit(RULE, { userId: 'u2' })).toBeNull()
  })

  it('applies the looser per-IP limit across users on one address (a clubhouse Wi-Fi)', async () => {
    for (let i = 0; i < 6; i++) expect(await enforceRateLimit(RULE, { userId: `golfer-${i}`, ip: '41.0.0.1' })).toBeNull()
    const res = await enforceRateLimit(RULE, { userId: 'golfer-7', ip: '41.0.0.1' })
    expect(res?.status).toBe(429)
    expect(await enforceRateLimit(RULE, { userId: 'golfer-7', ip: '41.0.0.2' })).toBeNull()
  })

  it('a rule with no per-IP limit never limits by IP', async () => {
    const noIp: RateRule = { ...RULE, perIp: null }
    for (let i = 0; i < 20; i++) expect(await enforceRateLimit(noIp, { userId: `g${i}`, ip: '41.0.0.1' })).toBeNull()
  })

  it('a pre-auth rule (perUser 0) limits by IP only', async () => {
    for (let i = 0; i < 6; i++) expect(await enforceRateLimit(RULE, { ip: '41.0.0.9' })).toBeNull()
    expect((await enforceRateLimit(RULE, { ip: '41.0.0.9' }))?.status).toBe(429)
    expect(RULES.authConfirm.perUser).toBe(0)
  })

  it('resets after the window', async () => {
    vi.useFakeTimers()
    try {
      for (let i = 0; i < 3; i++) await enforceRateLimit(RULE, { userId: 'u1' })
      expect(await enforceRateLimit(RULE, { userId: 'u1' })).not.toBeNull()
      vi.advanceTimersByTime(61_000)
      expect(await enforceRateLimit(RULE, { userId: 'u1' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails open when the counter backend is unavailable, and reports it', async () => {
    adminClient.createAdminClient.mockImplementation(() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set') })
    for (let i = 0; i < 10; i++) expect(await enforceRateLimit(RULE, { userId: 'u1' })).toBeNull()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('rate_limit.backend_unavailable'))
  })

  it('does nothing with no scope at all', async () => {
    expect(await enforceRateLimit(RULE, {})).toBeNull()
  })
})

describe('clientIp', () => {
  it('takes the first x-forwarded-for entry, then x-real-ip, then unknown', () => {
    expect(clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '41.0.0.1, 76.76.21.21' } }))).toBe('41.0.0.1')
    expect(clientIp(new Request('http://x', { headers: { 'x-real-ip': '41.0.0.2' } }))).toBe('41.0.0.2')
    expect(clientIp(new Request('http://x'))).toBe('unknown')
  })
})

describe('the rule table', () => {
  it('keeps per-IP limits well above per-user limits so a shared address is not the binding constraint', () => {
    for (const rule of Object.values(RULES)) {
      if (rule.perIp === null || rule.perUser === 0) continue
      expect(rule.perIp, rule.name).toBeGreaterThanOrEqual(rule.perUser * 20)
    }
  })
})
