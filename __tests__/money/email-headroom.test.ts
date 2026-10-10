/**
 * The email path under a spike: a Resend 429 is retried and not surfaced
 * as a failed sign-in, a final refusal still is; the ops email for one
 * event goes once per throttle window while Sentry sees every one; and the
 * outbox drains witness requests before the welcome backlog, a few at a
 * time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient } from '../helpers/fake-supabase'

const resendMock = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: resendMock.send } } }))
const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), withScope: vi.fn((fn: (s: unknown) => void) => fn({ setTag() {}, setLevel() {}, setContext() {} })), captureException: vi.fn(), addBreadcrumb: vi.fn() }))
vi.mock('@sentry/nextjs', () => sentry)

import { isRetryable, sendEmailWithRetry } from '@/lib/email/send'
import { alertOps, emailDue, resetAlertThrottle, EMAIL_THROTTLE_MS } from '@/lib/observability/alerts'
import { drainOutbox, enqueue, CONCURRENCY, URGENT_KINDS } from '@/lib/outbox'

const ok = { data: { id: 'em_1' }, error: null }
const tooMany = { data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests', statusCode: 429 } }
const bad = { data: null, error: { name: 'validation_error', message: 'Invalid to', statusCode: 422 } }
const noSleep = async () => {}

beforeEach(() => {
  resendMock.send.mockReset()
  sentry.captureMessage.mockReset()
  resetAlertThrottle()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('sendEmailWithRetry', () => {
  it('retries a 429 and succeeds, counting the tries', async () => {
    resendMock.send.mockResolvedValueOnce(tooMany).mockResolvedValueOnce(tooMany).mockResolvedValueOnce(ok)
    const res = await sendEmailWithRetry({ from: 'a@b.c', to: 'x@y.z', subject: 's', text: 't' }, { sleep: noSleep })
    expect(res.error).toBeNull()
    expect(res.tries).toBe(3)
    expect(resendMock.send).toHaveBeenCalledTimes(3)
  })

  it('gives up after the last try and reports the 429', async () => {
    resendMock.send.mockResolvedValue(tooMany)
    const res = await sendEmailWithRetry({ from: 'a@b.c', to: 'x@y.z', subject: 's', text: 't' }, { attempts: 4, sleep: noSleep })
    expect(res.error?.name).toBe('rate_limit_exceeded')
    expect(resendMock.send).toHaveBeenCalledTimes(4)
  })

  it('does not retry a refusal a second try cannot fix', async () => {
    resendMock.send.mockResolvedValue(bad)
    const res = await sendEmailWithRetry({ from: 'a@b.c', to: 'x@y.z', subject: 's', text: 't' }, { sleep: noSleep })
    expect(res.error?.name).toBe('validation_error')
    expect(resendMock.send).toHaveBeenCalledTimes(1)
  })

  it('treats a thrown network error like a 5xx', async () => {
    resendMock.send.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce(ok)
    const res = await sendEmailWithRetry({ from: 'a@b.c', to: 'x@y.z', subject: 's', text: 't' }, { sleep: noSleep })
    expect(res.error).toBeNull()
    expect(res.tries).toBe(2)
  })

  it('knows which errors are worth a retry', () => {
    expect(isRetryable({ statusCode: 429 })).toBe(true)
    expect(isRetryable({ statusCode: 503 })).toBe(true)
    expect(isRetryable({ name: 'rate_limit_exceeded' })).toBe(true)
    expect(isRetryable({ name: 'validation_error', statusCode: 422 })).toBe(false)
    expect(isRetryable(null)).toBe(false)
  })
})

describe('alert email throttle', () => {
  it('emails one event once per window, and a different event on its own clock', () => {
    expect(emailDue('a', 0)).toBe(true)
    expect(emailDue('a', 1_000)).toBe(false)
    expect(emailDue('b', 1_000)).toBe(true)
    expect(emailDue('a', EMAIL_THROTTLE_MS)).toBe(true)
  })

  it('alertOps still reports every occurrence to Sentry while the email is throttled', async () => {
    process.env.RESEND_API_KEY = 'test'
    resendMock.send.mockResolvedValue(ok)
    for (let i = 0; i < 5; i++) await alertOps({ event: 'auth.email_hook.send_failed', path: 'auth', summary: 'x' })
    expect(sentry.captureMessage.mock.calls.length).toBeGreaterThanOrEqual(5)   // log.error captures too
    expect(resendMock.send).toHaveBeenCalledTimes(1)
    delete process.env.RESEND_API_KEY
  })
})

describe('outbox under a backlog', () => {
  it('drains witness requests before the welcome backlog, with the limit over both', async () => {
    const db = new FakeDb()
    const admin = createFakeClient(db) as never
    resendMock.send.mockResolvedValue(ok)
    for (let i = 0; i < 6; i++) await enqueue(admin, 'welcome_email', { email: `g${i}@example.com` })
    // The witness job is newest, so by time alone it would be last.
    const witnessId = await enqueue(admin, 'witness_request', { betId: 'bet-1' })
    expect(URGENT_KINDS).toContain('witness_request')

    const r = await drainOutbox(admin, { now: new Date(Date.now() + 1_000), limit: 3 })
    expect(r.claimed).toBe(3)
    const witness = db.find('outbox', j => j.id === witnessId)!
    expect(witness.attempts).toBe(1)   // claimed in the first drain despite being last in line
    expect(db.rows('outbox').filter(j => j.kind === 'welcome_email' && Number(j.attempts) === 1)).toHaveLength(2)
  })

  it('runs welcome emails a few at a time', async () => {
    const db = new FakeDb()
    const admin = createFakeClient(db) as never
    let inFlight = 0, peak = 0
    resendMock.send.mockImplementation(async () => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return ok
    })
    for (let i = 0; i < 9; i++) await enqueue(admin, 'welcome_email', { email: `g${i}@example.com` })
    const r = await drainOutbox(admin, { now: new Date(Date.now() + 1_000) })
    expect(r).toMatchObject({ claimed: 9, done: 9 })
    expect(peak).toBe(CONCURRENCY)
    expect(db.rows('outbox').every(j => j.done_at)).toBe(true)
  })
})
