/**
 * src/lib/claims/triage.ts — claims with no footage are closed by the
 * nightly cron after a week, and only those.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { FakeDb, createFakeClient, USER_A, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'
import { closeClaimsWithoutFootage, NO_FOOTAGE_NOTE } from '@/lib/claims/triage'

const NOW = new Date('2026-09-15T02:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

let db: FakeDb
const admin = () => createFakeClient(db) as unknown as SupabaseClient<Database>
function claim(over: { bet?: Record<string, unknown>; claim?: Record<string, unknown> } = {}) {
  const [bet] = db.seed('bets', { user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'claimed', created_at: daysAgo(10), expires_at: daysAgo(9), video_sha256: null, ...over.bet })
  const [v] = db.seed('verifications', { bet_id: bet.id, status: 'documents_received', created_at: daysAgo(9), ...over.claim })
  return { bet, v }
}

beforeEach(() => {
  db = new FakeDb()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('closeClaimsWithoutFootage', () => {
  it('closes a week-old claim whose bet never had footage sealed and whose window has passed, with the reason on record', async () => {
    const { bet, v } = claim()
    expect(await closeClaimsWithoutFootage(admin(), { now: NOW })).toEqual({ noFootage: 1, errors: 0 })
    expect(v).toMatchObject({ status: 'rejected', reviewer_notes: NO_FOOTAGE_NOTE, review_checklist: { auto: 'no_footage' } })
    expect(bet.status).toBe('claimed')
  })

  it('leaves alone: sealed footage, a claim under review, a young claim, an open window, a resolved bet', async () => {
    const sealed = claim({ bet: { video_sha256: 'abc' } })
    const underReview = claim({ claim: { status: 'under_review' } })
    const young = claim({ claim: { created_at: daysAgo(3) } })
    const open = claim({ bet: { expires_at: new Date(NOW.getTime() + 3_600_000).toISOString() } })
    const verified = claim({ bet: { status: 'verified' }, claim: { status: 'pending' } })
    expect(await closeClaimsWithoutFootage(admin(), { now: NOW })).toEqual({ noFootage: 0, errors: 0 })
    expect(sealed.v.status).toBe('documents_received')
    expect(underReview.v.status).toBe('under_review')
    expect(young.v.status).toBe('documents_received')
    expect(open.v.status).toBe('documents_received')
    expect(verified.v.status).toBe('pending')
  })
})
