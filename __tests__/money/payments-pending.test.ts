/**
 * GET /api/payments/pending — paid shots not yet recorded: completed
 * payments with no bet, or whose bet is still active with no video.
 * Read-only; the only thing at stake is that a golfer never sees another
 * golfer's payment and never sees one that is already recorded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, USER_A, USER_B, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'
import { GET } from '@/app/api/payments/pending/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)

let db: FakeDb

function asUser(user: typeof USER_A | null = USER_A) {
  serverClient.createClient.mockResolvedValue(createFakeClient(db, user ? { user } : {}))
}

function ledgerRow(over: Record<string, unknown> = {}) {
  return db.seed('payfast_payments', {
    m_payment_id: 'gl_a', pf_payment_id: '1', user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID,
    tier: 'tier_1', amount_cents: 5000, status: 'complete', bet_id: null, created_at: '2026-09-16T09:16:28Z', ...over,
  })[0]
}

beforeEach(() => {
  db = new FakeDb()
  db.seed('courses', { id: COURSE_ID, name: 'Arabella Golf Club', is_partner: true })
  db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 5, par: 3, distance_metres: 161, is_active: true })
  serverClient.createClient.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('GET /api/payments/pending', () => {
  it('401 signed out', async () => {
    asUser(null)
    expect((await GET()).status).toBe(401)
  })

  it('lists the caller\'s complete, bet-less payments with course and hole', async () => {
    asUser()
    ledgerRow()
    ledgerRow({ m_payment_id: 'gl_b', user_id: USER_B.id })          // someone else's
    ledgerRow({ m_payment_id: 'gl_c', status: 'amount_mismatch' })   // not complete
    ledgerRow({ m_payment_id: 'gl_d', bet_id: 'bet-1' })             // linked, and the bet is recorded
    db.seed('bets', { id: 'bet-1', user_id: USER_A.id, payment_intent_id: 'gl_d', status: 'active', video_uploaded_at: '2026-09-16T09:20:00Z' })
    const res = await GET()
    expect(res.status).toBe(200)
    const { pending } = await res.json()
    expect(pending).toEqual([{
      m_payment_id: 'gl_a', tier: 'tier_1', amount_cents: 5000, created_at: '2026-09-16T09:16:28Z',
      course: { id: COURSE_ID, name: 'Arabella Golf Club' },
      hole: { id: HOLE_ID, hole_number: 5 },
    }])
  })

  it('keeps a payment whose bet exists but has no recording yet (the ITN granted it)', async () => {
    asUser()
    ledgerRow()
    db.seed('bets', { id: 'bet-9', user_id: USER_A.id, payment_intent_id: 'gl_a', status: 'active', video_uploaded_at: null })
    const { pending } = await (await GET()).json()
    expect(pending.map((p: { m_payment_id: string }) => p.m_payment_id)).toEqual(['gl_a'])
  })

  it('excludes a payment whose bet is resolved, even when the ledger link failed', async () => {
    asUser()
    ledgerRow()
    db.seed('bets', { id: 'bet-9', user_id: USER_A.id, payment_intent_id: 'gl_a', status: 'miss' })
    const { pending } = await (await GET()).json()
    expect(pending).toEqual([])
  })

  it('empty when there is nothing', async () => {
    asUser()
    const { pending } = await (await GET()).json()
    expect(pending).toEqual([])
  })
})
