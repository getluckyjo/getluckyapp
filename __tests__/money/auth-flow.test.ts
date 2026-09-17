/**
 * Sign-in completion: /auth/callback (PKCE code), /auth/confirm/verify
 * (token_hash) and the shared finishSignIn() they both run.
 *
 * What matters for money: nobody lands in the play flow without a session,
 * nobody skips the 18+ gate, and `next` can never become an open redirect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, formRequest, USER_A } from '../helpers/fake-supabase'
import { finishSignIn, safeNext, SAFE_NEXT_PATHS } from '@/lib/auth/finish-sign-in'
import { GET as callback } from '@/app/(onboarding)/auth/callback/route'
import { POST as verify, GET as verifyGet } from '@/app/(onboarding)/auth/confirm/verify/route'
import { drainOutbox } from '@/lib/outbox'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
const resendMock = vi.hoisted(() => ({ resend: { emails: { send: vi.fn() } } }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)
vi.mock('@/lib/resend', () => resendMock)

const ORIGIN = 'https://www.getluckyholeinone.com'
let db: FakeDb

const location = (res: Response) => res.headers.get('location')
const sendSpy = resendMock.resend.emails.send

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  sendSpy.mockReset()
  sendSpy.mockResolvedValue({ data: { id: 'email_123' }, error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

describe('safeNext', () => {
  it('allows only the listed in-app paths and falls back to /welcome', () => {
    for (const p of SAFE_NEXT_PATHS) expect(safeNext(p)).toBe(p)
    for (const bad of ['https://evil.example', '//evil.example', '/select-course?x=1', '', null, undefined, '/home/../admin']) {
      expect(safeNext(bad), String(bad)).toBe('/welcome')
    }
  })

  // /admin joined the list when the admin gate started sending a signed-out
  // admin to sign in and back. Landing there grants nothing: the gate asks
  // the server again on arrival, and a non-admin is told so on the screen.
  // The match is exact, so nothing deeper in the admin is a landing place.
  it('allows /admin itself but nothing built from it', () => {
    expect(safeNext('/admin')).toBe('/admin')
    for (const bad of ['/admin/payments', '/admin?x=1', '/adminx', '/admin/']) {
      expect(safeNext(bad), String(bad)).toBe('/welcome')
    }
  })
})

describe('finishSignIn', () => {
  it('bounces to /auth when there is no session', async () => {
    const res = await finishSignIn(createFakeClient(db, { user: null }) as never, ORIGIN, '/home')
    expect(location(res)).toBe(`${ORIGIN}/auth?error=no_session`)
  })

  it('first-timer: marks onboarding done, sends the welcome email to the session\'s own address, then goes to the age gate', async () => {
    const client = createFakeClient(db, { user: USER_A })
    const res = await finishSignIn(client as never, ORIGIN, '/home')

    expect(location(res)).toBe(`${ORIGIN}/age-check`)
    expect(db.find('profiles', p => p.id === USER_A.id)?.onboarding_done).toBe(true)
    // Queued, not sent in the request; the outbox drain sends it.
    expect(sendSpy).not.toHaveBeenCalled()
    expect(db.rows('outbox').map(j => [j.kind, (j.payload as { email: string }).email])).toEqual([['welcome_email', USER_A.email]])
    await drainOutbox(createFakeClient(db) as never)
    expect(sendSpy).toHaveBeenCalledOnce()
    const [msg] = sendSpy.mock.calls[0] as [{ to: string; subject: string; html: string; text: string }]
    expect(msg.to).toBe(USER_A.email)
    expect(msg.subject).toMatch(/Welcome/)
    expect(msg.html).toContain('Alice')
    expect(msg.text).toContain('Alice')
  })

  it('a welcome email failure is logged and does not block sign-in; the queue retries it', async () => {
    sendSpy.mockResolvedValue({ data: null, error: { message: 'Resend down' } })
    const res = await finishSignIn(createFakeClient(db, { user: USER_A }) as never, ORIGIN, '/home')
    expect(location(res)).toBe(`${ORIGIN}/age-check`)
    const r = await drainOutbox(createFakeClient(db) as never)
    expect(r).toMatchObject({ claimed: 1, retried: 1, done: 0 })
  })

  it('falls back to sending inline when the queue cannot be written', async () => {
    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db, { failTable: { outbox: { code: '42P01', message: 'relation "outbox" does not exist' } } }))
    const res = await finishSignIn(createFakeClient(db, { user: USER_A }) as never, ORIGIN, '/home')
    expect(location(res)).toBe(`${ORIGIN}/age-check`)
    expect(sendSpy).toHaveBeenCalledOnce()
  })

  it('returning user without age verification is still sent to the age gate, no welcome email', async () => {
    db.seed('profiles', { id: USER_A.id, onboarding_done: true, age_verified_at: null })
    const res = await finishSignIn(createFakeClient(db, { user: USER_A }) as never, ORIGIN, '/select-course')
    expect(location(res)).toBe(`${ORIGIN}/age-check`)
    expect(sendSpy).not.toHaveBeenCalled()
    expect(db.rows('outbox')).toHaveLength(0)
  })

  it('age-verified returning user lands on the requested safe path', async () => {
    db.seed('profiles', { id: USER_A.id, onboarding_done: true, age_verified_at: '2026-01-01T00:00:00Z' })
    const res = await finishSignIn(createFakeClient(db, { user: USER_A }) as never, ORIGIN, '/select-course')
    expect(location(res)).toBe(`${ORIGIN}/select-course`)
  })

  it('never redirects off-origin even when asked to', async () => {
    db.seed('profiles', { id: USER_A.id, onboarding_done: true, age_verified_at: '2026-01-01T00:00:00Z' })
    const res = await finishSignIn(createFakeClient(db, { user: USER_A }) as never, ORIGIN, 'https://evil.example/phish')
    expect(location(res)).toBe(`${ORIGIN}/welcome`)
  })
})

describe('GET /auth/callback', () => {
  it('exchanges a good code and completes sign-in', async () => {
    db.seed('profiles', { id: USER_A.id, onboarding_done: true, age_verified_at: '2026-01-01T00:00:00Z' })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const res = await callback(new Request(`${ORIGIN}/auth/callback?code=good-code&next=/home`) as never)
    expect(location(res)).toBe(`${ORIGIN}/home`)
  })

  it('sends a failed code exchange back to /auth with an error, not a 500', async () => {
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: null }))
    const res = await callback(new Request(`${ORIGIN}/auth/callback?code=bad-code`) as never)
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(location(res)).toBe(`${ORIGIN}/auth?error=oauth_error`)
  })

  it('survives Supabase being unreachable', async () => {
    serverClient.createClient.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await callback(new Request(`${ORIGIN}/auth/callback?code=good-code`) as never)
    expect(location(res)).toBe(`${ORIGIN}/auth?error=oauth_error`)
  })
})

describe('/auth/confirm/verify', () => {
  it('GET never consumes a token: it redirects to the confirm page with the query intact', async () => {
    const res = verifyGet(new Request(`${ORIGIN}/auth/confirm/verify?token_hash=abc&type=magiclink`) as never)
    expect(res.status).toBe(307)
    expect(location(res)).toBe(`${ORIGIN}/auth/confirm?token_hash=abc&type=magiclink`)
  })

  it('POST with a good token_hash signs in and answers with a 303 so the form is not re-posted', async () => {
    db.seed('profiles', { id: USER_A.id, onboarding_done: true, age_verified_at: '2026-01-01T00:00:00Z' })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const res = await verify(formRequest(`${ORIGIN}/auth/confirm/verify`, { token_hash: 'good-hash', type: 'magiclink', next: '/history' }) as never)
    expect(res.status).toBe(303)
    expect(location(res)).toBe(`${ORIGIN}/history`)
  })

  it('POST with an expired token_hash goes back to /auth?error=link_expired', async () => {
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: null }))
    const res = await verify(formRequest(`${ORIGIN}/auth/confirm/verify`, { token_hash: 'stale', type: 'magiclink' }) as never)
    expect(res.status).toBe(303)
    expect(location(res)).toBe(`${ORIGIN}/auth?error=link_expired`)
  })

  it('POST without a token_hash is rejected before touching Supabase', async () => {
    const res = await verify(formRequest(`${ORIGIN}/auth/confirm/verify`, { type: 'magiclink' }) as never)
    expect(location(res)).toBe(`${ORIGIN}/auth?error=link_invalid`)
    expect(serverClient.createClient).not.toHaveBeenCalled()
  })

  it('coerces an unknown OTP type to magiclink rather than passing it through', async () => {
    const client = createFakeClient(db, { user: USER_A })
    const spy = vi.spyOn(client.auth, 'verifyOtp')
    db.seed('profiles', { id: USER_A.id, onboarding_done: true, age_verified_at: '2026-01-01T00:00:00Z' })
    serverClient.createClient.mockResolvedValue(client)
    await verify(formRequest(`${ORIGIN}/auth/confirm/verify`, { token_hash: 'good-hash', type: 'something-else' }) as never)
    expect(spy).toHaveBeenCalledWith({ type: 'magiclink', token_hash: 'good-hash' })
  })
})
