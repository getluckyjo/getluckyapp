/**
 * The upload manager: seal first, then slot, PUT, seal; waits on backoff,
 * signal, sign-in and Retry-After; blocked on answers that will not
 * change; recovers every unsealed shot on start. A fake transport, clock
 * and online source stand in for the browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AUTH_WAIT_MS, UPLOAD_BACKOFF_MS, classifyHttp, createUploadManager, type FootageStore, type StoredRecord, type Timers } from '@/lib/upload/manager'
import { TransportError, type PrepareOutcome, type SealOutcome, type UploadTransport } from '@/lib/upload/types'
import { uploadChip } from '@/lib/upload/chip'
import type { OnlineSource } from '@/lib/net/online'

// ── Fakes ─────────────────────────────────────────────────────────────────
class FakeClock implements Timers {
  now = 1_000_000
  private timers: { at: number; fn: () => void; id: number }[] = []
  private seq = 0
  setTimeout(fn: () => void, ms: number) { const id = ++this.seq; this.timers.push({ at: this.now + ms, fn, id }); return id }
  clearTimeout(handle: unknown) { this.timers = this.timers.filter(t => t.id !== handle) }
  /** Advance, firing timers in order, and let promises settle between them. */
  async tick(ms: number) {
    const target = this.now + ms
    for (;;) {
      const next = this.timers.filter(t => t.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!next) break
      this.now = next.at
      this.timers = this.timers.filter(t => t.id !== next.id)
      next.fn()
      await flush()
    }
    this.now = target
    await flush()
  }
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

class FakeOnline implements OnlineSource {
  on = true
  private subs = new Set<(o: boolean) => void>()
  isOnline() { return this.on }
  subscribe(cb: (o: boolean) => void) { this.subs.add(cb); return () => { this.subs.delete(cb) } }
  set(on: boolean) { this.on = on; this.subs.forEach(cb => cb(on)) }
}

class FakeStore implements FootageStore {
  rows = new Map<string, StoredRecord>()
  async save(r: StoredRecord) { this.rows.set(r.betId, { ...r }); return true }
  async load() { return [...this.rows.values()] }
  async markSealed(betId: string) { const r = this.rows.get(betId); if (r) r.sealed = true }
}

/** A scripted transport: each call pops the next answer for that method. */
class FakeTransport implements UploadTransport {
  calls: string[] = []
  seals: (SealOutcome | TransportError)[] = []
  prepares: (PrepareOutcome | TransportError)[] = []
  puts: (null | TransportError)[] = []
  async seal(betId: string) { this.calls.push(`seal:${betId}`); return this.next(this.seals, { kind: 'missing' } as SealOutcome) }
  async prepare(betId: string) { this.calls.push(`prepare:${betId}`); return this.next(this.prepares, { kind: 'slot', signedUrl: 'https://s/x', storagePath: 'p' } as PrepareOutcome) }
  async put(_u: string, _b: Blob, _m: string, onProgress: (p: number) => void) {
    this.calls.push('put')
    const r = this.next(this.puts, null)
    onProgress(50)
    if (r) throw r
  }
  private next<T>(queue: (T | TransportError)[], fallback: T): T {
    const v = queue.length ? queue.shift()! : fallback
    if (v instanceof TransportError) throw v
    return v
  }
}

const blob = new Blob(['video bytes'], { type: 'video/webm' })
let clock: FakeClock, online: FakeOnline, store: FakeStore, transport: FakeTransport
let signedIn: (() => void) | null
const log = vi.fn()

function manager() {
  return createUploadManager({ transport, store, online, now: () => clock.now, timers: clock, random: () => 0.5, onSignedIn: cb => { signedIn = cb; return () => {} }, log })
}
beforeEach(() => { clock = new FakeClock(); online = new FakeOnline(); store = new FakeStore(); transport = new FakeTransport(); signedIn = null; log.mockReset() })

describe('an attempt', () => {
  it('stores first, then seals, asks for a slot, sends the bytes and seals again', async () => {
    const m = manager()
    transport.seals = [{ kind: 'missing' }, { kind: 'sealed' }]
    await m.enqueue({ betId: 'b1', blob, mimeType: 'video/webm' })
    expect(store.rows.get('b1')?.sealed).toBe(false)
    await flush()
    expect(transport.calls).toEqual(['seal:b1', 'prepare:b1', 'put', 'seal:b1'])
    expect(m.get('b1')).toMatchObject({ status: 'done', progress: 100, attempt: 1 })
    expect(store.rows.get('b1')?.sealed).toBe(true)
  })

  it('an earlier PUT that landed with its answer lost is sealed without sending a byte', async () => {
    const m = manager()
    transport.seals = [{ kind: 'sealed' }]
    await m.enqueue({ betId: 'b1', blob, mimeType: 'video/webm' })
    await flush()
    expect(transport.calls).toEqual(['seal:b1'])
    expect(m.get('b1')?.status).toBe('done')
  })

  it('FOOTAGE_SEALED from the slot request is done too', async () => {
    const m = manager()
    transport.prepares = [{ kind: 'sealed' }]
    await m.enqueue({ betId: 'b1', blob, mimeType: 'video/webm' })
    await flush()
    expect(transport.calls).toEqual(['seal:b1', 'prepare:b1'])
    expect(m.get('b1')?.status).toBe('done')
  })
})

describe('waiting', () => {
  it('a dropped PUT waits on the backoff schedule (with jitter) and then tries again', async () => {
    const m = manager()
    transport.puts = [new TransportError('network', 'dropped'), null]
    transport.seals = [{ kind: 'missing' }, { kind: 'missing' }, { kind: 'sealed' }]
    await m.enqueue({ betId: 'b1', blob, mimeType: 'video/webm' })
    await flush()
    expect(m.get('b1')).toMatchObject({ status: 'waiting', waitingOn: 'backoff', attempt: 1, nextRetryAt: clock.now + UPLOAD_BACKOFF_MS[0] })
    await clock.tick(UPLOAD_BACKOFF_MS[0] - 1)
    expect(m.get('b1')?.status).toBe('waiting')
    await clock.tick(1)
    expect(m.get('b1')?.status).toBe('done')
    expect(transport.calls.filter(c => c === 'put')).toHaveLength(2)
  })

  it('the schedule grows to five minutes and stays there', async () => {
    const m = manager()
    transport.puts = Array.from({ length: 9 }, () => new TransportError('timeout', 'slow'))
    await m.enqueue({ betId: 'b1', blob, mimeType: 'video/webm' })
    await flush()
    const waits: number[] = []
    for (let i = 0; i < 8; i++) {
      const st = m.get('b1')!
      waits.push(st.nextRetryAt! - clock.now)
      await clock.tick(st.nextRetryAt! - clock.now)
    }
    expect(waits).toEqual([...UPLOAD_BACKOFF_MS, 300_000])
  })

  it('offline: waits for the signal rather than spending attempts, then goes at once', async () => {
    const m = manager()
    online.set(false)
    await m.enqueue({ betId: 'b1', blob, mimeType: 'video/webm' })
    await flush()
    expect(m.get('b1')).toMatchObject({ status: 'waiting', waitingOn: 'online' })
    expect(transport.calls).toEqual([])
    await clock.tick(10 * 60_000)
    expect(transport.calls).toEqual([])
    transport.seals = [{ kind: 'missing' }, { kind: 'sealed' }]
    online.set(true)
    await flush()
    expect(m.get('b1')?.status).toBe('done')
  })

  it('a 429 waits at least Retry-After; a 401 waits for sign-in', async () => {
    const m = manager()
    transport.seals = [new TransportError('rate_limited', 'slow down', undefined, 90_000), { kind: 'missing' }, { kind: 'sealed' }]
    await m.enqueue({ betId: 'b1', blob, mimeType: 'video/webm' })
    await flush()
    expect(m.get('b1')).toMatchObject({ status: 'waiting', waitingOn: 'rate_limit', nextRetryAt: clock.now + 90_000 })
    await clock.tick(90_000)
    expect(m.get('b1')?.status).toBe('done')

    transport.seals = [new TransportError('unauthorized', 'signed out'), { kind: 'missing' }, { kind: 'sealed' }]
    await m.enqueue({ betId: 'b2', blob, mimeType: 'video/webm' })
    await flush()
    expect(m.get('b2')).toMatchObject({ status: 'waiting', waitingOn: 'auth', nextRetryAt: clock.now + AUTH_WAIT_MS })
    signedIn?.()
    await flush()
    expect(m.get('b2')?.status).toBe('done')
  })

  it('kick() retries now and clears a blocked state for one more go', async () => {
    const m = manager()
    transport.seals = [new TransportError('blocked', 'too big', 'too_large'), { kind: 'missing' }, { kind: 'sealed' }]
    await m.enqueue({ betId: 'b1', blob, mimeType: 'video/webm' })
    await flush()
    expect(m.get('b1')).toMatchObject({ status: 'blocked', blocked: 'too_large' })
    m.kick('b1')
    await flush()
    expect(m.get('b1')?.status).toBe('done')
  })
})

describe('blocked answers', () => {
  it('403, 410, 413, a resolved bet and a bad type stop the attempts and say why', () => {
    expect(classifyHttp(403, undefined)).toMatchObject({ reason: 'blocked', blocked: 'not_yours' })
    expect(classifyHttp(410, 'FOOTAGE_WINDOW_CLOSED')).toMatchObject({ reason: 'blocked', blocked: 'expired' })
    expect(classifyHttp(413, 'FOOTAGE_TOO_LARGE')).toMatchObject({ reason: 'blocked', blocked: 'too_large' })
    expect(classifyHttp(409, 'INVALID_TRANSITION')).toMatchObject({ reason: 'blocked', blocked: 'resolved' })
    expect(classifyHttp(400, 'INVALID_INPUT')).toMatchObject({ reason: 'blocked', blocked: 'unsupported_type' })
    expect(classifyHttp(401, undefined).reason).toBe('unauthorized')
    expect(classifyHttp(429, 'RATE_LIMITED', 5000)).toMatchObject({ reason: 'rate_limited', retryAfterMs: 5000 })
    expect(classifyHttp(503, undefined).reason).toBe('server')
  })
})

describe('recovery and order', () => {
  it('recover() queues every unsealed record and none of the sealed; the newest goes first; one at a time', async () => {
    await store.save({ betId: 'old', blob, mimeType: 'video/webm', capture: null, savedAt: 1, sealed: false })
    await store.save({ betId: 'done', blob, mimeType: 'video/webm', capture: null, savedAt: 2, sealed: true })
    await store.save({ betId: 'new', blob, mimeType: 'video/webm', capture: null, savedAt: 3, sealed: false })
    const m = manager()
    transport.seals = [{ kind: 'sealed' }, { kind: 'sealed' }]
    expect(await m.recover()).toBe(2)
    await flush()
    expect(transport.calls).toEqual(['seal:new', 'seal:old'])
    expect(m.get('done')).toBeUndefined()
    expect(m.all().map(s => s.status)).toEqual(['new', 'old'].map(() => 'done'))
  })

  it('enqueue twice for the same bet is one job', async () => {
    const m = manager()
    transport.seals = [{ kind: 'missing' }, { kind: 'sealed' }]
    await m.enqueue({ betId: 'b1', blob, mimeType: 'video/webm' })
    await m.enqueue({ betId: 'b1', blob, mimeType: 'video/webm' })
    await flush()
    expect(m.all()).toHaveLength(1)
    expect(transport.calls.filter(c => c === 'put')).toHaveLength(1)
  })
})

describe('the chip', () => {
  it('says what the screen should', () => {
    const base = { betId: 'b', progress: 0, attempt: 1, nextRetryAt: null, waitingOn: null } as const
    expect(uploadChip(undefined)).toMatchObject({ tone: 'busy', retry: false })
    expect(uploadChip({ ...base, status: 'uploading', progress: 40 })).toMatchObject({ tone: 'busy', label: 'Saving video · 40%' })
    expect(uploadChip({ ...base, status: 'done' })).toMatchObject({ tone: 'ok', label: 'Video saved' })
    expect(uploadChip({ ...base, status: 'waiting', waitingOn: 'online' })).toMatchObject({ tone: 'wait', retry: true })
    expect(uploadChip({ ...base, status: 'waiting', waitingOn: 'backoff', nextRetryAt: 15_000 }, 0).label).toBe('Retrying in 15s. Tap to retry now')
    expect(uploadChip({ ...base, status: 'blocked', blocked: 'too_large' })).toMatchObject({ tone: 'error', retry: true })
  })
})
