/**
 * GET /api/health — the uptime probe: the database answers, the outbox is
 * being drained, nothing internal leaks, and it cannot be used to hammer
 * the database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient } from './helpers/fake-supabase'
import { GET } from '@/app/api/health/route'
import { BACKLOG_MINUTES, checkHealth } from '@/lib/health'
import { RULES } from '@/lib/rate-limit'

const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const get = (ip = '41.0.0.1') => GET(new Request('http://x/api/health', { headers: { 'x-forwarded-for': ip } }))

beforeEach(() => {
  db = new FakeDb()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('GET /api/health', () => {
  it('200 when the database answers and nothing is overdue; a quiet outbox is idle, not broken', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(await res.json()).toMatchObject({ ok: true, db: 'ok', outbox: 'idle', outboxBacklog: 0, lastDrainAt: null, failing: [] })
  })

  it('reports the last drain and ignores jobs that are due but not yet overdue', async () => {
    db.seed('outbox',
      { kind: 'welcome_email', payload: {}, attempts: 1, next_attempt_at: minutesAgo(30), done_at: minutesAgo(3) },
      { kind: 'welcome_email', payload: {}, attempts: 1, next_attempt_at: minutesAgo(30), done_at: minutesAgo(1) },
      // Due two minutes ago: the cron has eight more minutes before this counts.
      { kind: 'welcome_email', payload: {}, attempts: 0, next_attempt_at: minutesAgo(2) },
      // A dead letter is not a backlog: ops were already alerted.
      { kind: 'welcome_email', payload: {}, attempts: 6, next_attempt_at: minutesAgo(600), failed_at: minutesAgo(500) },
    )
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, outbox: 'ok', outboxBacklog: 0 })
    expect(Date.now() - Date.parse(body.lastDrainAt)).toBeLessThan(2 * 60_000)
  })

  it('503 naming the outbox when a job has waited longer than the backlog window', async () => {
    db.seed('outbox', { kind: 'witness_request', payload: {}, attempts: 0, next_attempt_at: minutesAgo(BACKLOG_MINUTES + 1) })
    const res = await get()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ ok: false, db: 'ok', outbox: 'backlog', outboxBacklog: 1, failing: ['outbox'] })
  })

  it('503 naming the database when it cannot be read, with no error text in the body', async () => {
    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db, {
      failTable: { courses: { code: '57P01', message: 'FATAL: terminating connection due to administrator command' } },
    }))
    const res = await get()
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ ok: false, db: 'error', failing: ['db'] })
    expect(text).not.toContain('FATAL')
    expect(text).not.toContain('57P01')
  })

  it('503 on both parts when the service role client cannot be made, still without the reason', async () => {
    adminClient.createAdminClient.mockImplementation(() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. Required for server-to-server operations.') })
    const res = await get()
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ ok: false, db: 'error', outbox: 'error', failing: ['db', 'outbox'] })
    expect(text).not.toContain('SERVICE_ROLE')
  })

  it('is rate limited per IP so it cannot be used to hammer the database', async () => {
    expect(RULES.health).toMatchObject({ perUser: 0, perIp: 60, windowSeconds: 600 })
    for (let i = 0; i < 60; i++) expect((await get()).status, `call ${i + 1}`).toBe(200)
    const res = await get()
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeTruthy()
    expect((await get('41.0.0.2')).status).toBe(200)
  })
})

describe('checkHealth', () => {
  it('counts only jobs that are overdue, not done and not dead', async () => {
    db.seed('outbox',
      { kind: 'a', payload: {}, attempts: 0, next_attempt_at: minutesAgo(11) },
      { kind: 'b', payload: {}, attempts: 2, next_attempt_at: minutesAgo(45) },
      { kind: 'c', payload: {}, attempts: 1, next_attempt_at: minutesAgo(45), done_at: minutesAgo(44) },
      { kind: 'd', payload: {}, attempts: 6, next_attempt_at: minutesAgo(45), failed_at: minutesAgo(40) },
      { kind: 'e', payload: {}, attempts: 0, next_attempt_at: minutesAgo(9) },
    )
    const report = await checkHealth(createFakeClient(db) as never)
    expect(report).toMatchObject({ ok: false, outbox: 'backlog', outboxBacklog: 2, failing: ['outbox'] })
    expect(report.lastDrainAt).toBe(db.rows('outbox')[2].done_at)
  })
})
