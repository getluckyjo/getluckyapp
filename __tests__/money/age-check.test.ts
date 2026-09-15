/**
 * POST /api/profile/age-check — the server-side 18+ decision.
 *
 * Migration 006 makes age_verified_at read-only to the browser; this route is
 * the only way it gets set. The money path (bets/create) trusts it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A } from '../helpers/fake-supabase'
import { POST, ageFromDob } from '@/app/api/profile/age-check/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb
const post = (body: unknown) => POST(jsonRequest('http://x/api/profile/age-check', body) as never)
const yearsAgo = (n: number, extraDays = 0) => {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  d.setUTCDate(d.getUTCDate() + extraDays)
  return d.toISOString().slice(0, 10)
}

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('ageFromDob', () => {
  it('counts whole years and handles the birthday boundary', () => {
    const today = new Date(Date.UTC(2026, 8, 15))
    expect(ageFromDob('2008-09-15', today)).toBe(18)
    expect(ageFromDob('2008-09-16', today)).toBe(17)
    expect(ageFromDob('1985-06-15', today)).toBe(41)
  })
  it('rejects impossible dates', () => {
    expect(ageFromDob('2000-02-30')).toBeNull()
    expect(ageFromDob('2000-13-01')).toBeNull()
  })
})

describe('POST /api/profile/age-check', () => {
  it('401 without a session', async () => {
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: null }))
    expect((await post({ dateOfBirth: '1985-06-15', consent: true })).status).toBe(401)
  })

  it('400 on a malformed or impossible date', async () => {
    for (const dateOfBirth of ['', '15/06/1985', '1985-02-30', 'yesterday', 12345]) {
      const res = await post({ dateOfBirth, consent: true })
      expect(res.status, String(dateOfBirth)).toBe(400)
    }
    expect(db.rows('profiles')).toHaveLength(0)
  })

  it('403 UNDER_18 for a 17-year-old, writing nothing', async () => {
    const res = await post({ dateOfBirth: yearsAgo(18, 1), consent: true })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('UNDER_18')
    expect(db.rows('profiles')).toHaveLength(0)
  })

  it('400 CONSENT_REQUIRED when the terms are not accepted', async () => {
    const res = await post({ dateOfBirth: '1985-06-15', consent: false })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('CONSENT_REQUIRED')
  })

  it('verifies an adult: writes the three server-owned columns with server timestamps', async () => {
    db.seed('profiles', { id: USER_A.id, name: 'Alice Ace', age_verified_at: null })
    const before = Date.now()
    const res = await post({ dateOfBirth: '1985-06-15', consent: true, age_verified_at: '1999-01-01T00:00:00Z' })
    expect(res.status).toBe(200)

    const profile = db.find('profiles', p => p.id === USER_A.id)!
    expect(profile.date_of_birth).toBe('1985-06-15')
    expect(profile.onboarding_done).toBe(true)
    expect(Date.parse(profile.age_verified_at as string)).toBeGreaterThanOrEqual(before - 1000)
    expect(profile.terms_accepted_at).toBe(profile.age_verified_at)
    expect(profile.name).toBe('Alice Ace')
  })

  it('accepts someone who turned 18 today', async () => {
    expect((await post({ dateOfBirth: yearsAgo(18), consent: true })).status).toBe(200)
  })
})
