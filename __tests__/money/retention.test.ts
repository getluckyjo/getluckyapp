/**
 * Retention (Batch 8, POPIA): the nightly purge and the cron route in front of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { FakeDb, createFakeClient, USER_A, COURSE_ID, HOLE_ID, type FakeClientOptions } from '../helpers/fake-supabase'
import { runRetention, retentionDays, DEFAULT_RETENTION_DAYS } from '@/lib/retention'
import { GET as cron } from '@/app/api/cron/retention/route'

const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => adminClient)

const NOW = new Date('2026-09-15T02:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

let db: FakeDb
const admin = (opts: FakeClientOptions = {}) => createFakeClient(db, opts) as unknown as SupabaseClient<Database>
const bet = (over: Record<string, unknown> = {}) =>
  db.seed('bets', { user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'active', ...over })[0]

beforeEach(() => {
  db = new FakeDb()
  adminClient.createAdminClient.mockImplementation(() => admin())
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('retentionDays', () => {
  it('defaults to 90, honours RETENTION_DAYS, refuses silly values', () => {
    expect(retentionDays({})).toBe(DEFAULT_RETENTION_DAYS)
    expect(retentionDays({ RETENTION_DAYS: '30' })).toBe(30)
    expect(retentionDays({ RETENTION_DAYS: '2' })).toBe(DEFAULT_RETENTION_DAYS)
    expect(retentionDays({ RETENTION_DAYS: 'soon' })).toBe(DEFAULT_RETENTION_DAYS)
  })
})

describe('runRetention', () => {
  it('purges footage of misses older than the window and leaves the rest', async () => {
    const old = bet({ status: 'miss', declared_at: daysAgo(91), video_url: `${USER_A.id}/old/shot.mp4`, video_sha256: 'abc' })
    const oldNoFootage = bet({ status: 'miss', declared_at: daysAgo(120), video_url: null })
    const recent = bet({ status: 'miss', declared_at: daysAgo(89), video_url: `${USER_A.id}/recent/shot.mp4` })
    const active = bet({ status: 'active', video_url: `${USER_A.id}/active/shot.mp4` })
    const paid = bet({ status: 'paid', declared_at: daysAgo(400), video_url: `${USER_A.id}/paid/shot.mp4` })
    for (const b of [old, recent, active, paid]) db.putObject('shot-videos', b.video_url as string)

    const result = await runRetention(admin(), { now: NOW })

    expect(result).toMatchObject({ days: 90, misses: 2, rejectedClaims: 0, objectsRemoved: 1, errors: 0 })
    expect(old).toMatchObject({ video_url: null, footage_purged_at: NOW.toISOString(), video_sha256: 'abc' })
    expect(oldNoFootage).toMatchObject({ video_url: null, footage_purged_at: NOW.toISOString() })
    expect(recent.footage_purged_at).toBeUndefined()
    expect(db.objectPaths('shot-videos')).toEqual([
      `${USER_A.id}/active/shot.mp4`, `${USER_A.id}/paid/shot.mp4`, `${USER_A.id}/recent/shot.mp4`,
    ])
  })

  it('purges documents and footage of rejected claims older than the window', async () => {
    const b = bet({ status: 'claimed', video_url: `${USER_A.id}/b/shot.mp4` })
    const v = db.seed('verifications', {
      bet_id: b.id, status: 'rejected', updated_at: daysAgo(91),
      certificate_path: `${USER_A.id}/b/cert/c.pdf`, affidavit_path: `${USER_A.id}/b/aff/a.pdf`,
    })[0]
    const fresh = bet({ status: 'claimed', video_url: `${USER_A.id}/fresh/shot.mp4` })
    const vFresh = db.seed('verifications', { bet_id: fresh.id, status: 'rejected', updated_at: daysAgo(10), certificate_path: `${USER_A.id}/fresh/c.pdf` })[0]
    const approved = bet({ status: 'verified', video_url: `${USER_A.id}/ok/shot.mp4` })
    db.seed('verifications', { bet_id: approved.id, status: 'approved', updated_at: daysAgo(400), certificate_path: `${USER_A.id}/ok/c.pdf` })
    for (const p of [`${USER_A.id}/b/cert/c.pdf`, `${USER_A.id}/b/aff/a.pdf`, `${USER_A.id}/fresh/c.pdf`, `${USER_A.id}/ok/c.pdf`]) db.putObject('verification-docs', p)
    for (const p of [`${USER_A.id}/b/shot.mp4`, `${USER_A.id}/fresh/shot.mp4`, `${USER_A.id}/ok/shot.mp4`]) db.putObject('shot-videos', p)

    const result = await runRetention(admin(), { now: NOW })

    expect(result).toMatchObject({ misses: 0, rejectedClaims: 1, objectsRemoved: 3, errors: 0 })
    expect(v).toMatchObject({ certificate_path: null, affidavit_path: null, documents_purged_at: NOW.toISOString() })
    expect(b).toMatchObject({ video_url: null, footage_purged_at: NOW.toISOString(), status: 'claimed' })
    expect(vFresh.documents_purged_at).toBeUndefined()
    expect(db.objectPaths('verification-docs')).toEqual([`${USER_A.id}/fresh/c.pdf`, `${USER_A.id}/ok/c.pdf`])
    expect(db.objectPaths('shot-videos')).toEqual([`${USER_A.id}/fresh/shot.mp4`, `${USER_A.id}/ok/shot.mp4`])
  })

  it('counts a storage failure, leaves the row unmarked for the next run, and carries on', async () => {
    const a = bet({ status: 'miss', declared_at: daysAgo(100), video_url: `${USER_A.id}/a/shot.mp4` })
    const b = bet({ status: 'miss', declared_at: daysAgo(100), video_url: null })
    db.putObject('shot-videos', a.video_url as string)

    const result = await runRetention(admin({ storageRemoveError: 'storage down' }), { now: NOW })

    expect(result).toMatchObject({ misses: 1, errors: 1, objectsRemoved: 0 })
    expect(a.footage_purged_at).toBeUndefined()
    expect(a.video_url).toBe(`${USER_A.id}/a/shot.mp4`)
    expect(b.footage_purged_at).toBe(NOW.toISOString())
  })

  it('respects RETENTION_DAYS and the per-run limit', async () => {
    vi.stubEnv('RETENTION_DAYS', '30')
    bet({ status: 'miss', declared_at: daysAgo(31) })
    bet({ status: 'miss', declared_at: daysAgo(31) })
    bet({ status: 'miss', declared_at: daysAgo(29) })
    const result = await runRetention(admin(), { now: NOW, limit: 1 })
    expect(result).toMatchObject({ days: 30, misses: 1 })
    expect(db.rows('bets').filter(b => b.footage_purged_at).length).toBe(1)
  })
})

describe('GET /api/cron/retention', () => {
  const call = (auth?: string) => cron(new Request('http://x/api/cron/retention', { headers: auth ? { authorization: auth } : {} }) as never)

  it('503 when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await call('Bearer anything')).status).toBe(503)
  })

  it('401 without the right bearer token', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
    expect((await call('Bearer s3cret-but-longer')).status).toBe(401)
  })

  it('runs the sweep and reports counts', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    bet({ status: 'miss', declared_at: daysAgo(200), video_url: `${USER_A.id}/x/shot.mp4` })
    db.putObject('shot-videos', `${USER_A.id}/x/shot.mp4`)
    const res = await call('Bearer s3cret')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ misses: 1, objectsRemoved: 1, errors: 0, days: 90 })
    expect(db.objectPaths('shot-videos')).toEqual([])
  })
})
