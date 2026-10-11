/**
 * The shot stays on the phone until the server has it: written the moment
 * recording stops, read back after a restart, marked sealed once hashed,
 * pruned when stale, and never a crash when there is no storage at all.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { FOOTAGE_TTL_MS, deleteFootage, loadFootage, markFootageSealed, pickRecovery, saveFootage, type StoredFootage } from '@/lib/footage-store'

const NOW = Date.parse('2026-12-11T09:00:00Z')
const SESSION = { selectedCourse: { id: 'c1', name: 'Fancourt' }, selectedHole: { id: 'h1', holeNumber: 7 }, selectedTier: 'tier_1', prize: null, prizeCurrency: 'ZAR' as const }
const record = (betId: string, over: Partial<StoredFootage> = {}): StoredFootage => ({
  betId,
  blob: new Blob(['not really a video'], { type: 'video/webm' }),
  mimeType: 'video/webm;codecs=vp9',
  capture: { startedAt: '2026-12-11T08:58:00Z', endedAt: '2026-12-11T08:58:30Z', durationMs: 30_000 },
  session: SESSION,
  savedAt: NOW,
  sealed: false,
  ...over,
})

beforeEach(() => {
  // A fresh database per test.
  globalThis.indexedDB = new IDBFactory()
})
afterEach(() => vi.restoreAllMocks())

describe('the store', () => {
  it('writes a shot and reads it back with its bytes, report and session', async () => {
    expect(await saveFootage(record('bet-1'))).toBe(true)
    const rows = await loadFootage()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ betId: 'bet-1', mimeType: 'video/webm;codecs=vp9', sealed: false, session: SESSION })
    expect(rows[0].capture?.durationMs).toBe(30_000)
    expect(await rows[0].blob.text()).toBe('not really a video')
  })

  it('one record per bet: a second save replaces the first', async () => {
    await saveFootage(record('bet-1'))
    await saveFootage(record('bet-1', { blob: new Blob(['take two']) }))
    const rows = await loadFootage()
    expect(rows).toHaveLength(1)
    expect(await rows[0].blob.text()).toBe('take two')
  })

  it('marks a shot sealed and deletes one on request; unknown ids are no-ops', async () => {
    await saveFootage(record('bet-1'))
    await markFootageSealed('bet-1')
    await markFootageSealed('bet-missing')
    expect((await loadFootage())[0].sealed).toBe(true)
    await deleteFootage('bet-missing')
    await deleteFootage('bet-1')
    expect(await loadFootage()).toEqual([])
  })

  it('without IndexedDB (a private window, an old browser) every call is quiet', async () => {
    // @ts-expect-error — the browser has no storage at all
    globalThis.indexedDB = undefined
    expect(await saveFootage(record('bet-1'))).toBe(false)
    expect(await loadFootage()).toEqual([])
    await expect(markFootageSealed('bet-1')).resolves.toBeUndefined()
    await expect(deleteFootage('bet-1')).resolves.toBeUndefined()
  })

  it('ignores rows that are not footage', async () => {
    await saveFootage(record('bet-1'))
    await saveFootage({ betId: 'junk', blob: 'not a blob' as unknown as Blob, mimeType: 'x', capture: null, session: SESSION, savedAt: NOW, sealed: false })
    expect((await loadFootage()).map(r => r.betId)).toEqual(['bet-1'])
  })
})

describe('pickRecovery', () => {
  it('restores the newest shot inside the window and names the rest stale', () => {
    const older = record('bet-old', { savedAt: NOW - 3_600_000 })
    const newest = record('bet-new', { savedAt: NOW - 60_000 })
    const expired = record('bet-expired', { savedAt: NOW - FOOTAGE_TTL_MS - 1 })
    const { restore, stale } = pickRecovery([older, expired, newest], NOW)
    expect(restore?.betId).toBe('bet-new')
    expect(stale.sort()).toEqual(['bet-expired', 'bet-old'])
  })

  it('nothing fresh → nothing to restore, everything stale', () => {
    const { restore, stale } = pickRecovery([record('a', { savedAt: NOW - FOOTAGE_TTL_MS }), record('b', { savedAt: Number.NaN })], NOW)
    expect(restore).toBeNull()
    expect(stale.sort()).toEqual(['a', 'b'])
  })

  it('a clock set in the future is not a fresh shot', () => {
    const { restore, stale } = pickRecovery([record('a', { savedAt: NOW + 60_000 })], NOW)
    expect(restore).toBeNull()
    expect(stale).toEqual(['a'])
  })

  it('a sealed shot still restores, so the replay and the result screens survive a reload', () => {
    const { restore } = pickRecovery([record('a', { sealed: true })], NOW)
    expect(restore?.sealed).toBe(true)
  })

  it('empty in, empty out', () => {
    expect(pickRecovery([], NOW)).toEqual({ restore: null, stale: [] })
  })
})
