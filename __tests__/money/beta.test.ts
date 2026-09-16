/**
 * Closed beta (migration 016): the gate helper, code redemption, the admin
 * list, and feedback with its outbox email.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B } from '../helpers/fake-supabase'
import { betaGateApplies, betaGateEnabled, betaAllowed, generateInviteCode, BETA_COOKIE } from '@/lib/beta'
import { drainOutbox } from '@/lib/outbox'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
const resendMock = vi.hoisted(() => ({ resend: { emails: { send: vi.fn() } } }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)
vi.mock('@/lib/resend', () => resendMock)

import { POST as redeem } from '@/app/api/beta/redeem/route'
import { GET as listBeta, POST as addBeta, DELETE as removeBeta } from '@/app/api/admin/beta/route'
import { POST as feedback } from '@/app/api/feedback/route'

let db: FakeDb
const admin = () => createFakeClient(db) as unknown as SupabaseClient<Database>
const asUser = (user: typeof USER_A | null) => serverClient.createClient.mockResolvedValue(createFakeClient(db, user ? { user } : {}))
const asAdmin = () => {
  db.seed('profiles', { id: USER_A.id, name: 'Seed Admin', is_admin: true })
  asUser(USER_A)
}

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  resendMock.resend.emails.send.mockReset().mockResolvedValue({ data: { id: 'e1' }, error: null })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('gate helper', () => {
  it('is off unless BETA_GATE=on', () => {
    expect(betaGateEnabled({})).toBe(false)
    expect(betaGateEnabled({ BETA_GATE: 'off' })).toBe(false)
    expect(betaGateEnabled({ BETA_GATE: 'ON ' })).toBe(true)
  })

  it('leaves sign-in, marketing, legal, the gate page, the PayFast return and plumbing open', () => {
    for (const p of ['/', '/auth', '/auth/callback', '/splash', '/onboarding', '/terms', '/privacy', '/responsible-play', '/beta', '/witness/abc', '/payment-return', '/age-check', '/welcome', '/api/bets', '/admin/users', '/~offline', '/serwist/sw.js', '/manifest.webmanifest']) {
      expect(betaGateApplies(p), p).toBe(false)
    }
  })

  it('gates the app screens', () => {
    for (const p of ['/home', '/leaderboard', '/history', '/account', '/icons', '/select-course', '/choose-stake', '/record', '/verify', '/result/claim']) {
      expect(betaGateApplies(p), p).toBe(true)
    }
  })

  it('matches emails and codes case- and space-insensitively', async () => {
    db.seed('beta_access', { id: 1, kind: 'email', value: 'golfer@example.com' }, { id: 2, kind: 'code', value: 'gl-abc12345' })
    expect(await betaAllowed(admin(), { email: '  Golfer@Example.com ' })).toBe(true)
    expect(await betaAllowed(admin(), { code: 'GL-ABC12345' })).toBe(true)
    expect(await betaAllowed(admin(), { email: 'other@example.com', code: 'nope' })).toBe(false)
    expect(await betaAllowed(admin(), {})).toBe(false)
  })

  it('generates codes from an unambiguous alphabet', () => {
    const code = generateInviteCode()
    expect(code).toMatch(/^GL-[A-HJ-NP-Z2-9]{8}$/)
    expect(generateInviteCode()).not.toBe(code)
  })
})

describe('POST /api/beta/redeem', () => {
  it('sets the cookie for a listed code', async () => {
    db.seed('beta_access', { id: 1, kind: 'code', value: 'gl-abc12345' })
    asUser(null)
    const res = await redeem(jsonRequest('http://x/api/beta/redeem', { code: ' gl-ABC12345 ' }))
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${BETA_COOKIE}=gl-abc12345`)
    expect(cookie.toLowerCase()).toContain('httponly')
  })

  it('refuses an unknown code with 403 and no cookie', async () => {
    asUser(null)
    const res = await redeem(jsonRequest('http://x/api/beta/redeem', { code: 'GL-NOPE0000' }))
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect((await res.json()).code).toBe('BETA_CODE_INVALID')
  })

  it('rejects a malformed body', async () => {
    asUser(null)
    expect((await redeem(jsonRequest('http://x/api/beta/redeem', { code: 'ab' }))).status).toBe(400)
  })

  it('is rate limited per IP', async () => {
    asUser(null)
    let last = 0
    for (let i = 0; i < 21; i++) {
      const res = await redeem(jsonRequest('http://x/api/beta/redeem', { code: 'GL-NOPE0000' }, { headers: { 'x-forwarded-for': '203.0.113.9' } }))
      last = res.status
    }
    expect(last).toBe(429)
  })
})

describe('/api/admin/beta', () => {
  it('requires an admin', async () => {
    asUser(USER_B)
    expect((await listBeta()).status).toBe(403)
    serverClient.createClient.mockResolvedValue(createFakeClient(db))
    expect((await listBeta()).status).toBe(401)
  })

  it('adds an email (normalised), generates a code, lists both, removes one', async () => {
    asAdmin()
    const e = await addBeta(jsonRequest('http://x/api/admin/beta', { kind: 'email', value: ' Golfer@Example.COM ', note: 'Pro at Fancourt' }))
    expect(e.status).toBe(201)
    expect((await e.json()).data).toMatchObject({ kind: 'email', value: 'golfer@example.com', note: 'Pro at Fancourt', added_by: USER_A.id })

    const c = await addBeta(jsonRequest('http://x/api/admin/beta', { kind: 'code' }))
    expect(c.status).toBe(201)
    const code = (await c.json()).data
    expect(code.value).toMatch(/^gl-[a-z0-9]{8}$/)

    const list = await (await listBeta()).json()
    expect(list.data).toHaveLength(2)
    expect(list.gate).toBe(false)

    // Real rows carry a bigint identity; the fake hands out uuids, so seed one to remove.
    db.seed('beta_access', { id: 42, kind: 'code', value: 'gl-oldcode1' })
    const del = await removeBeta(new Request('http://x/api/admin/beta?id=42', { method: 'DELETE' }))
    expect(del.status).toBe(200)
    expect(db.rows('beta_access')).toHaveLength(2)
    expect((await removeBeta(new Request('http://x/api/admin/beta?id=abc', { method: 'DELETE' }))).status).toBe(400)
  })

  it('rejects a bad email and a duplicate', async () => {
    asAdmin()
    expect((await addBeta(jsonRequest('http://x/api/admin/beta', { kind: 'email', value: 'not-an-email' }))).status).toBe(400)
    db.seed('beta_access', { id: 9, kind: 'email', value: 'golfer@example.com' })
    const dup = await addBeta(jsonRequest('http://x/api/admin/beta', { kind: 'email', value: 'golfer@example.com' }))
    expect(dup.status).toBe(409)
  })
})

describe('POST /api/feedback', () => {
  const body = { message: 'The Play button did nothing on the 7th tee.', route: '/record', standalone: true, appVersion: 'abc1234', buildDate: '2026-09-15T20:00:00.000Z', screen: '393x852@3' }

  it('stores the note with its context and emails ops through the outbox', async () => {
    db.seed('profiles', { id: USER_A.id, name: 'Alice', email: USER_A.email })
    asUser(USER_A)
    const res = await feedback(jsonRequest('http://x/api/feedback', body, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' } }))
    expect(res.status).toBe(201)
    const row = db.rows('feedback')[0]
    expect(row).toMatchObject({ user_id: USER_A.id, message: body.message, route: '/record', standalone: true, app_version: 'abc1234', screen: '393x852@3', user_agent: 'Mozilla/5.0 (iPhone)' })
    const job = db.rows('outbox')[0]
    expect(job).toMatchObject({ kind: 'feedback_email', payload: { feedbackId: row.id } })

    expect(await drainOutbox(admin(), { now: new Date(Date.now() + 1000) })).toMatchObject({ done: 1 })
    const sent = resendMock.resend.emails.send.mock.calls[0][0]
    expect(sent.to).toBe('johannes@getluckygolfclub.com')
    expect(sent.subject).toContain('Beta feedback')
    expect(sent.text).toContain('Alice <a@example.com>')
    expect(sent.text).toContain('installed app')
    expect(sent.text).toContain(body.message)
  })

  it('works signed out', async () => {
    asUser(null)
    const res = await feedback(jsonRequest('http://x/api/feedback', { message: 'Cannot sign in, the code never arrives.' }))
    expect(res.status).toBe(201)
    expect(db.rows('feedback')[0].user_id).toBeNull()
  })

  it('rejects an empty or oversized message', async () => {
    asUser(null)
    expect((await feedback(jsonRequest('http://x/api/feedback', { message: '   ' }))).status).toBe(400)
    expect((await feedback(jsonRequest('http://x/api/feedback', { message: 'x'.repeat(4001) }))).status).toBe(400)
  })
})
