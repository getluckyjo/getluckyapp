/**
 * The claim state machine, exhaustively. Every (actor, from, to) triple is
 * either in the allowed table or refused; there is no third case.
 */
import { describe, it, expect } from 'vitest'
import {
  BET_STATUSES, VERIFICATION_STATUSES, canTransitionBet, canTransitionVerification,
  betWindowHours, computeExpiresAt, isExpired, assertOpen, ClaimError,
  type BetStatus, type VerificationStatus,
} from '@/lib/claims/state-machine'

const ALLOWED_BET: [string, BetStatus, BetStatus][] = [
  ['player', 'active', 'miss'],
  ['player', 'active', 'claimed'],
  ['review', 'claimed', 'verified'],
  ['admin', 'verified', 'paid'],
]

const ALLOWED_VERIFICATION: [VerificationStatus, VerificationStatus][] = [
  ['pending', 'documents_received'], ['pending', 'under_review'], ['pending', 'approved'], ['pending', 'rejected'],
  ['documents_received', 'under_review'], ['documents_received', 'approved'], ['documents_received', 'rejected'],
  ['under_review', 'approved'], ['under_review', 'rejected'],
]

describe('bet transitions', () => {
  it('allows exactly the four listed transitions and nothing else', () => {
    for (const actor of ['player', 'review', 'admin'] as const) {
      for (const from of BET_STATUSES) {
        for (const to of BET_STATUSES) {
          const expected = ALLOWED_BET.some(([a, f, t]) => a === actor && f === from && t === to)
          expect(canTransitionBet(actor, from, to), `${actor}: ${from} → ${to}`).toBe(expected)
        }
      }
    }
  })

  it('never lets anyone leave paid, and never lets a player touch a resolved bet', () => {
    for (const actor of ['player', 'review', 'admin'] as const) {
      for (const to of BET_STATUSES) expect(canTransitionBet(actor, 'paid', to)).toBe(false)
    }
    for (const from of ['miss', 'claimed', 'verified', 'paid'] as const) {
      for (const to of BET_STATUSES) expect(canTransitionBet('player', from, to)).toBe(false)
    }
  })
})

describe('verification transitions', () => {
  it('allows exactly the listed transitions; approved and rejected are terminal', () => {
    for (const from of VERIFICATION_STATUSES) {
      for (const to of VERIFICATION_STATUSES) {
        const expected = ALLOWED_VERIFICATION.some(([f, t]) => f === from && t === to)
        expect(canTransitionVerification(from, to), `${from} → ${to}`).toBe(expected)
      }
    }
  })
})

describe('play window', () => {
  it('defaults to 24 hours and accepts an override between 1 and 168', () => {
    expect(betWindowHours({})).toBe(24)
    expect(betWindowHours({ BET_WINDOW_HOURS: '6' })).toBe(6)
    expect(betWindowHours({ BET_WINDOW_HOURS: '0' })).toBe(24)
    expect(betWindowHours({ BET_WINDOW_HOURS: '999' })).toBe(24)
    expect(betWindowHours({ BET_WINDOW_HOURS: 'soon' })).toBe(24)
  })

  it('computes expires_at from creation time', () => {
    const created = new Date('2026-09-15T10:00:00Z')
    expect(computeExpiresAt(created, {})).toBe('2026-09-16T10:00:00.000Z')
    expect(computeExpiresAt(created, { BET_WINDOW_HOURS: '2' })).toBe('2026-09-15T12:00:00.000Z')
  })

  it('isExpired is inclusive of the boundary and tolerant of legacy rows', () => {
    const now = Date.parse('2026-09-16T10:00:00Z')
    expect(isExpired({ expires_at: '2026-09-16T10:00:00Z' }, now)).toBe(true)
    expect(isExpired({ expires_at: '2026-09-16T10:00:01Z' }, now)).toBe(false)
    expect(isExpired({ expires_at: null }, now)).toBe(false)
    expect(isExpired({}, now)).toBe(false)
  })

  it('assertOpen: resolved is 409, expired is 410, open passes', () => {
    expect(() => assertOpen({ status: 'miss' })).toThrow(ClaimError)
    try { assertOpen({ status: 'miss' }) } catch (e) { expect((e as ClaimError).status).toBe(409) }
    try { assertOpen({ status: 'active', expires_at: '2000-01-01T00:00:00Z' }) } catch (e) { expect((e as ClaimError).status).toBe(410) }
    expect(() => assertOpen({ status: 'active', expires_at: '2999-01-01T00:00:00Z' })).not.toThrow()
  })
})
