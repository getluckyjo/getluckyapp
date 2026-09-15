/**
 * The outbox (Stage 4, Batch 12): enqueue, claim, run, retry with backoff,
 * dead-letter, and the cron route in front of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { FakeDb, createFakeClient, USER_A, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'
import { enqueue, drainOutbox, BACKOFF_SECONDS, MAX_ATTEMPTS, LEASE_SECONDS } from '@/lib/outbox'
import { GET as cron } from '@/app/api/cron/outbox/route'

const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
const resendMock = vi.hoisted(() => ({ resend: { emails: { send: vi.fn() } } }))
vi.mock('@/lib/supabase/admin', () => adminClient)
vi.mock('@/lib/resend', () => resendMock)

/** A moment just after whatever was enqueued in the test, so it is due. */
const after = (ms = 1_000) => new Date(Date.now() + ms)
let db: FakeDb
const admin = () => createFakeClient(db) as unknown as SupabaseClient<Database>

beforeEach(() => {
  db = new FakeDb()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  resendMock.resend.emails.send.mockReset().mockResolvedValue({ data: { id: 'e1' }, error: null })
  db.seed('profiles', { id: USER_A.id, name: 'Alice', email: USER_A.email })
  db.seed('courses', { id: COURSE_ID, name: 'Fancourt' })
  db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 7 })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('enqueue and drain', () => {
  it('runs a due job once and marks it done', async () => {
    const id = await enqueue(admin(), 'welcome_email', { email: 'new@example.com', name: 'New Golfer' })
    const row = db.find('outbox', r => r.id === id)!
    expect(row).toMatchObject({ kind: 'welcome_email', attempts: 0 })
    expect(row.done_at).toBeUndefined()
    expect(await drainOutbox(admin(), { now: after() })).toEqual({ claimed: 1, done: 1, retried: 0, dead: 0 })
    expect(row.attempts).toBe(1)
    expect(typeof row.done_at).toBe('string')
    expect(resendMock.resend.emails.send.mock.calls[0][0]).toMatchObject({ to: 'new@example.com' })
    expect(await drainOutbox(admin(), { now: after() })).toEqual({ claimed: 0, done: 0, retried: 0, dead: 0 })
  })

  it('leaves jobs that are not due yet, and respects the limit', async () => {
    await enqueue(admin(), 'welcome_email', { email: 'a@example.com' })
    const later = await enqueue(admin(), 'welcome_email', { email: 'b@example.com' })
    db.find('outbox', r => r.id === later)!.next_attempt_at = after(60_000).toISOString()
    await enqueue(admin(), 'welcome_email', { email: 'c@example.com' })
    expect(await drainOutbox(admin(), { now: after(), limit: 1 })).toMatchObject({ claimed: 1, done: 1 })
    expect(await drainOutbox(admin(), { now: after() })).toMatchObject({ claimed: 1, done: 1 })
    expect(resendMock.resend.emails.send.mock.calls.map(c => c[0].to)).toEqual(['a@example.com', 'c@example.com'])
  })

  it('a failure schedules the retry with backoff; the claim itself is the lease', async () => {
    resendMock.resend.emails.send.mockResolvedValue({ data: null, error: { message: 'Resend down' } })
    const id = await enqueue(admin(), 'welcome_email', { email: 'a@example.com' })
    const row = db.find('outbox', r => r.id === id)!
    const t1 = after()
    expect(await drainOutbox(admin(), { now: t1 })).toMatchObject({ claimed: 1, retried: 1 })
    expect(row).toMatchObject({ attempts: 1, last_error: 'Resend down' })
    expect(row.next_attempt_at).toBe(new Date(t1.getTime() + BACKOFF_SECONDS[0] * 1000).toISOString())
    // Not due yet: nothing happens.
    expect(await drainOutbox(admin(), { now: new Date(t1.getTime() + 30_000) })).toMatchObject({ claimed: 0 })
    // A runner that died mid-job: the row shows the lease, and it becomes due again when the lease lapses.
    row.next_attempt_at = new Date(t1.getTime() + LEASE_SECONDS * 1000).toISOString()
    expect(await drainOutbox(admin(), { now: new Date(t1.getTime() + 10_000) })).toMatchObject({ claimed: 0 })
    expect(await drainOutbox(admin(), { now: new Date(t1.getTime() + LEASE_SECONDS * 1000) })).toMatchObject({ claimed: 1, retried: 1 })
    expect(row.attempts).toBe(2)
  })

  it('after the last attempt the job is a dead letter and ops are alerted', async () => {
    resendMock.resend.emails.send.mockResolvedValue({ data: null, error: { message: 'still down' } })
    const id = await enqueue(admin(), 'welcome_email', { email: 'a@example.com' })
    const row = db.find('outbox', r => r.id === id)!
    row.attempts = MAX_ATTEMPTS - 1
    expect(await drainOutbox(admin(), { now: after() })).toMatchObject({ claimed: 1, dead: 1 })
    expect(typeof row.failed_at).toBe('string')
    expect((console.error as ReturnType<typeof vi.fn>).mock.calls.some(c => String(c[0]).includes('outbox.dead_letter'))).toBe(true)
    expect(await drainOutbox(admin(), { now: after(86_400_000) })).toMatchObject({ claimed: 0 })
  })

  it('an unknown kind is retried like any failure, never crashes the drain', async () => {
    db.seed('outbox', { kind: 'carrier_pigeon', payload: {}, attempts: 0, next_attempt_at: new Date().toISOString() })
    await enqueue(admin(), 'welcome_email', { email: 'a@example.com' })
    expect(await drainOutbox(admin(), { now: after() })).toMatchObject({ claimed: 2, done: 1, retried: 1 })
  })

  it('witness_request sends to the people named on the bet and retries while any are unsent', async () => {
    const [bet] = db.seed('bets', { user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, status: 'claimed', declared_at: new Date().toISOString() })
    db.seed('claim_witnesses', { bet_id: bet.id, role: 'witness', name: 'A', email: 'a@example.com' }, { bet_id: bet.id, role: 'witness', name: 'B', email: 'b@example.com' })
    resendMock.resend.emails.send.mockResolvedValueOnce({ data: null, error: { message: 'bounce' } })
    await enqueue(admin(), 'witness_request', { betId: bet.id as string })
    const t1 = after()
    expect(await drainOutbox(admin(), { now: t1 })).toMatchObject({ claimed: 1, retried: 1 })
    expect(await drainOutbox(admin(), { now: new Date(t1.getTime() + BACKOFF_SECONDS[0] * 1000) })).toMatchObject({ claimed: 1, done: 1 })
    // The first send (a) bounced, b went; the retry sends only a.
    expect(resendMock.resend.emails.send.mock.calls.map(c => c[0].to)).toEqual(['a@example.com', 'b@example.com', 'a@example.com'])
    expect(db.rows('claim_witnesses').every(w => w.requested_at)).toBe(true)
  })
})

describe('GET /api/cron/outbox', () => {
  const call = (auth?: string) => cron(new Request('http://x/api/cron/outbox', { headers: auth ? { authorization: auth } : {} }) as never)
  it('503 unconfigured, 401 wrong token, 200 drains', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await call('Bearer x')).status).toBe(503)
    vi.stubEnv('CRON_SECRET', 's3cret')
    expect((await call('Bearer wrong')).status).toBe(401)
    await enqueue(admin(), 'welcome_email', { email: 'a@example.com' })
    const res = await call('Bearer s3cret')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ claimed: 1, done: 1 })
  })
})
