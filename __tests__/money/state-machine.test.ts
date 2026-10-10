/**
 * The claim state machine, exhaustively. Every (actor, from, to) triple is
 * either in the allowed table or refused; there is no third case.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BET_STATUSES, VERIFICATION_STATUSES, canTransitionBet, canTransitionVerification,
  betWindowHours, computeExpiresAt, isExpired, assertOpen, ClaimError, transitionBet,
  CLAIMED_BET_STATUSES, OWED_BET_STATUSES, WON_BET_STATUSES, SECOND_APPROVER_MESSAGE,
  type BetStatus, type VerificationStatus,
} from '@/lib/claims/state-machine'
import { FakeDb, createFakeClient, USER_A, USER_B } from '../helpers/fake-supabase'

const ALLOWED_BET: [string, BetStatus, BetStatus][] = [
  ['player', 'active', 'miss'],
  ['player', 'active', 'claimed'],
  ['review', 'claimed', 'verified'],
  ['admin', 'verified', 'payout_approved'],
  ['admin', 'payout_approved', 'paid'],
]

const ALLOWED_VERIFICATION: [VerificationStatus, VerificationStatus][] = [
  ['pending', 'documents_received'], ['pending', 'under_review'], ['pending', 'approved'], ['pending', 'rejected'],
  ['documents_received', 'under_review'], ['documents_received', 'approved'], ['documents_received', 'rejected'],
  ['under_review', 'approved'], ['under_review', 'rejected'],
]

describe('bet transitions', () => {
  it('allows exactly the five listed transitions and nothing else', () => {
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
    for (const from of ['miss', 'claimed', 'verified', 'payout_approved', 'paid'] as const) {
      for (const to of BET_STATUSES) expect(canTransitionBet('player', from, to)).toBe(false)
    }
  })

  it('paid is reached only through payout_approved: an admin cannot go from verified straight to paid', () => {
    expect(canTransitionBet('admin', 'verified', 'paid')).toBe(false)
    expect(canTransitionBet('admin', 'verified', 'payout_approved')).toBe(true)
    expect(canTransitionBet('admin', 'payout_approved', 'paid')).toBe(true)
    expect(canTransitionBet('admin', 'payout_approved', 'verified')).toBe(false)
  })

  it('the status groups the lists and reports use cover the new state and keep paid terminal', () => {
    expect(BET_STATUSES).toEqual(['active', 'miss', 'claimed', 'verified', 'payout_approved', 'paid'])
    expect(CLAIMED_BET_STATUSES).toEqual(['claimed', 'verified', 'payout_approved', 'paid'])
    expect(OWED_BET_STATUSES).toEqual(['verified', 'payout_approved'])
    expect(WON_BET_STATUSES).toEqual(['verified', 'payout_approved', 'paid'])
  })
})

describe('transitionBet: two signatures on a payout', () => {
  let db: FakeDb
  const admin = () => createFakeClient(db) as never
  beforeEach(() => {
    db = new FakeDb()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('approving records who and when; a different admin can then mark it paid', async () => {
    const [bet] = db.seed('bets', { user_id: 'golfer', status: 'verified' })
    await transitionBet(admin(), { betId: bet.id as string, from: 'verified', to: 'payout_approved', actor: 'admin', actorId: USER_A.id })
    expect(bet).toMatchObject({ status: 'payout_approved', payout_approved_by: USER_A.id, updated_by: USER_A.id })
    expect(typeof bet.payout_approved_at).toBe('string')

    await transitionBet(admin(), { betId: bet.id as string, from: 'payout_approved', to: 'paid', actor: 'admin', actorId: USER_B.id, extra: { payout_reference: 'FNB-1' } })
    expect(bet).toMatchObject({ status: 'paid', payout_approved_by: USER_A.id, updated_by: USER_B.id, payout_reference: 'FNB-1' })
  })

  it('refuses the approver as the payer: 409 SECOND_APPROVER_REQUIRED, nothing written', async () => {
    const [bet] = db.seed('bets', { user_id: 'golfer', status: 'verified' })
    await transitionBet(admin(), { betId: bet.id as string, from: 'verified', to: 'payout_approved', actor: 'admin', actorId: USER_A.id })
    const attempt = transitionBet(admin(), { betId: bet.id as string, from: 'payout_approved', to: 'paid', actor: 'admin', actorId: USER_A.id, extra: { payout_reference: 'FNB-1' } })
    await expect(attempt).rejects.toMatchObject({ code: 'SECOND_APPROVER_REQUIRED', status: 409, message: SECOND_APPROVER_MESSAGE })
    expect(bet).toMatchObject({ status: 'payout_approved', payout_approved_by: USER_A.id })
    expect(bet.payout_reference).toBeUndefined()
  })

  it('verified → paid in one step is an invalid transition even for an admin', async () => {
    const [bet] = db.seed('bets', { user_id: 'golfer', status: 'verified' })
    await expect(transitionBet(admin(), { betId: bet.id as string, from: 'verified', to: 'paid', actor: 'admin', actorId: USER_A.id }))
      .rejects.toMatchObject({ code: 'INVALID_TRANSITION', status: 409 })
    expect(bet.status).toBe('verified')
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
