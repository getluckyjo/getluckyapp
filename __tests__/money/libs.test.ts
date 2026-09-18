/**
 * The small shared libraries the routes lean on: tiers and amounts, the
 * PayFast address list, CSV escaping, display formatting. These import the
 * real modules; the previous version of this file tested private copies.
 */
import { describe, it, expect, vi } from 'vitest'
import { ALL_TIERS, BET_TIERS, FREE_TIER, TIER_LABELS, TIER_STAKE_CENTS, TIER_WIN_CENTS, isFreeTier, tierByKey } from '@/lib/tiers'
import { verifyPaymentAmount, parseAmountToCents, expectedStakeCents } from '@/lib/payments'
import { PAYFAST_IPS, isFromPayfast, isFromPayfastLive, resetResolvedPayfastIps } from '@/lib/payfast/ips'
import { toCSV } from '@/lib/admin/csv'
import { formatRand, formatRandFromCents, formatZAR, getInitials, timeAgo } from '@/lib/format'

describe('BET_TIERS', () => {
  it('has six tiers, sorted by stake, each paying at least 500×', () => {
    expect(BET_TIERS).toHaveLength(6)
    for (let i = 0; i < BET_TIERS.length; i++) {
      const t = BET_TIERS[i]
      expect(t.tier).toMatch(/^tier_[1-6]$/)
      expect(t.winZAR / t.stakeZAR).toBeGreaterThanOrEqual(500)
      expect(t.multiplier).toBe(Math.round(t.winZAR / t.stakeZAR))
      if (i > 0) expect(t.stakeZAR).toBeGreaterThan(BET_TIERS[i - 1].stakeZAR)
    }
  })

  it('derived cent maps agree with the table', () => {
    for (const t of BET_TIERS) {
      expect(TIER_STAKE_CENTS[t.tier]).toBe(t.stakeZAR * 100)
      expect(TIER_WIN_CENTS[t.tier]).toBe(t.winZAR * 100)
      expect(expectedStakeCents(t.tier)).toBe(t.stakeZAR * 100)
    }
    expect(expectedStakeCents('tier_99')).toBeNull()
  })
})

describe('FREE_TIER', () => {
  it('is a free entry for a real R10,000 prize', () => {
    expect(FREE_TIER).toMatchObject({ tier: 'tier_free', stakeZAR: 0, winZAR: 10000 })
    expect(TIER_WIN_CENTS.tier_free).toBe(1_000_000)
    expect(TIER_STAKE_CENTS.tier_free).toBe(0)
    expect(TIER_LABELS.tier_free).toBeTruthy()
  })

  it('is never sellable: the paid table and the payment check both reject it', () => {
    expect(BET_TIERS.map(t => t.tier)).not.toContain('tier_free')
    expect(expectedStakeCents('tier_free')).toBeNull()
    expect(verifyPaymentAmount('tier_free', 0).ok).toBe(false)
  })

  it('is still a describable bet: ALL_TIERS and tierByKey know it', () => {
    expect(ALL_TIERS).toHaveLength(BET_TIERS.length + 1)
    expect(tierByKey('tier_free')).toBe(FREE_TIER)
    expect(tierByKey('tier_1')?.stakeZAR).toBe(50)
    expect(tierByKey('tier_99')).toBeUndefined()
    expect(isFreeTier('tier_free')).toBe(true)
    expect(isFreeTier('tier_1')).toBe(false)
    expect(isFreeTier(null)).toBe(false)
  })
})

describe('payment amounts', () => {
  it('parses PayFast decimal strings to integer cents', () => {
    expect(parseAmountToCents('50.00')).toBe(5000)
    expect(parseAmountToCents('1000')).toBe(100000)
    expect(parseAmountToCents('49.999')).toBe(5000)
    expect(parseAmountToCents(undefined)).toBe(0)
    expect(parseAmountToCents('abc')).toBeNaN()
  })

  it('verifies the paid amount against the tier exactly, in cents', () => {
    expect(verifyPaymentAmount('tier_1', 5000)).toEqual({ ok: true, tier: 'tier_1', expectedCents: 5000 })
    expect(verifyPaymentAmount('tier_1', 4999)).toMatchObject({ ok: false, reason: 'amount_mismatch', expectedCents: 5000 })
    expect(verifyPaymentAmount('tier_9', 5000)).toMatchObject({ ok: false, reason: 'unknown_tier', expectedCents: null })
    expect(verifyPaymentAmount('tier_5', NaN)).toMatchObject({ ok: false, reason: 'amount_mismatch' })
  })
})

describe('PayFast addresses', () => {
  it('covers the five published ranges plus the observed w1w address (82) and nothing else', () => {
    expect(PAYFAST_IPS.size).toBe(82)
    for (const ip of ['197.97.145.144', '197.97.145.159', '41.74.179.192', '41.74.179.223', '102.216.36.0', '102.216.36.15', '102.216.36.128', '102.216.36.143', '144.126.193.139', '13.245.74.88']) {
      expect(PAYFAST_IPS.has(ip), ip).toBe(true)
    }
    for (const ip of ['197.97.145.143', '197.97.145.160', '41.74.179.191', '41.74.179.224', '102.216.36.16', '102.216.36.127', '1.2.3.4', '10.0.0.1']) {
      expect(PAYFAST_IPS.has(ip), ip).toBe(false)
    }
  })

  it('finds a PayFast address anywhere in a forwarded chain', () => {
    expect(isFromPayfast(['197.97.145.150', '76.76.21.21'])).toBe(true)
    expect(isFromPayfast(['76.76.21.21', ' 41.74.179.200 '])).toBe(true)
    expect(isFromPayfast(['203.0.113.10'])).toBe(false)
    expect(isFromPayfast([])).toBe(false)
  })

  it('also accepts an address PayFast\'s hostnames resolve to, and caches the lookup', async () => {
    resetResolvedPayfastIps()
    const resolver = vi.fn(async (host: string) => (host === 'w1w.payfast.co.za' ? ['198.51.100.7'] : []))
    expect(await isFromPayfastLive(['198.51.100.7'], resolver)).toBe(true)
    expect(await isFromPayfastLive(['198.51.100.8'], resolver)).toBe(false)
    expect(resolver).toHaveBeenCalledTimes(4)
    // A listed address never needs the lookup.
    expect(await isFromPayfastLive(['197.97.145.150'], resolver)).toBe(true)
    expect(resolver).toHaveBeenCalledTimes(4)
    resetResolvedPayfastIps()
  })

  it('falls back to the static list when resolution fails, and never under vitest without a resolver', async () => {
    resetResolvedPayfastIps()
    const failing = vi.fn(async () => { throw new Error('ENOTFOUND') })
    expect(await isFromPayfastLive(['203.0.113.10'], failing)).toBe(false)
    expect(await isFromPayfastLive(['41.74.179.200'], failing)).toBe(true)
    resetResolvedPayfastIps()
    expect(await isFromPayfastLive(['203.0.113.10'])).toBe(false)
    resetResolvedPayfastIps()
  })
})

describe('toCSV', () => {
  it('quotes every cell, doubles quotes, and neutralises formula triggers', () => {
    const csv = toCSV(['A', 'B'], [['hello "world"', '=cmd|calc'], ['+1234', '-1234'], ['@SUM(A1)', '\tx'], ['plain', '']])
    expect(csv.split('\n')).toEqual([
      '"A","B"',
      '"hello ""world""","\'=cmd|calc"',
      '"\'+1234","\'-1234"',
      '"\'@SUM(A1)","\'\tx"',
      '"plain",""',
    ])
  })
})

describe('format', () => {
  it('rand and cents with non-breaking-space thousands', () => {
    expect(formatRand(25000)).toBe('R25\u00a0000')
    expect(formatRand(1_000_000)).toBe('R1\u00a0000\u00a0000')
    expect(formatRand(50)).toBe('R50')
    expect(formatRandFromCents(2_500_000)).toBe('R25\u00a0000')
    expect(formatRandFromCents(5000)).toBe('R50')
    expect(formatRandFromCents(5049)).toBe('R50')
    expect(formatZAR(5000)).toBe('R50')
    expect(formatZAR(5049)).toMatch(/^R50[.,]49$/)
  })
  it('initials', () => {
    expect(getInitials('Thabo Mokoena', null)).toBe('TM')
    expect(getInitials('  Cher ', null)).toBe('C')
    expect(getInitials(null, 'golfer@example.test')).toBe('G')
    expect(getInitials(null, null)).toBe('GL')
  })
  it('timeAgo', () => {
    const now = Date.now()
    expect(timeAgo(new Date(now - 30_000).toISOString())).toBe('just now')
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago')
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString())).toBe('3h ago')
    expect(timeAgo(new Date(now - 49 * 3_600_000).toISOString())).toBe('2d ago')
    expect(timeAgo(new Date(now - 10 * 86_400_000).toISOString())).toMatch(/^\d{1,2} [A-Z][a-z]{2,4}\.?$/)
  })
})
