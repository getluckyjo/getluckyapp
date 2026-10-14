/**
 * The upload manager: every shot still on the phone, and the work of getting
 * each one to the server, owned by one object that lives for the whole app,
 * outside React. Leaving the play screens, tapping Home, or the provider
 * remounting cannot abandon an upload; only a sealed hash on the server ends
 * one.
 *
 * Per bet, an attempt is: seal (in case an earlier PUT landed and its
 * answer was lost) → slot → PUT → seal. A failure that may pass (no
 * signal, a dropped link, a timeout, a 429, a 5xx) waits on a backoff that
 * grows to five minutes and stays there, with jitter; the wait is cut short
 * the moment the phone comes online, the app returns to the foreground or
 * the golfer signs back in. A failure that will not pass (not their bet,
 * footage window closed, too large, bad type) is 'blocked' and shown.
 *
 * Pure of the DOM: the browser pieces (XHR, window events, IndexedDB) are
 * injected, so the tests run under node with a fake transport and clock.
 */
import type { CaptureInput } from '@/lib/claims/capture'
import { backoffDelay } from '@/lib/net/backoff'
import type { OnlineSource } from '@/lib/net/online'
import { TransportError, type BlockedReason, type UploadState, type UploadTransport } from './types'

export const UPLOAD_BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000] as const
/** A 401 waits for the session to come back; this long at most before trying anyway. */
export const AUTH_WAIT_MS = 60_000

export interface FootageStore {
  save(record: StoredRecord): Promise<boolean>
  load(): Promise<StoredRecord[]>
  markSealed(betId: string): Promise<void>
}

export interface StoredRecord {
  betId: string
  blob: Blob
  mimeType: string
  capture: CaptureInput | null
  savedAt: number
  sealed: boolean
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface ManagerDeps {
  transport: UploadTransport
  store: FootageStore
  online: OnlineSource
  now?: () => number
  timers?: Timers
  random?: () => number
  /** Fires when the golfer's session is (re)established; wakes an upload parked on a 401. */
  onSignedIn?: (cb: () => void) => () => void
  log?: (event: string, fields: Record<string, unknown>) => void
}

interface Job {
  betId: string
  blob: Blob
  mimeType: string
  capture: CaptureInput | null
  savedAt: number
  state: UploadState
  /** Resolves the wait early. */
  wake: (() => void) | null
  abort: AbortController | null
}

export interface UploadManager {
  enqueue(input: { betId: string; blob: Blob; mimeType: string; capture?: CaptureInput | null; alreadyStored?: boolean; savedAt?: number }): Promise<void>
  /** Retry now (one bet, or every waiting one). */
  kick(betId?: string): void
  get(betId: string): UploadState | undefined
  all(): UploadState[]
  subscribe(cb: () => void): () => void
  /** Enqueue every unsealed record the store holds. */
  recover(): Promise<number>
  /** Tests and sign-out: stop everything, forget nothing on disk. */
  stopAll(): void
}

const noopUnsub = () => {}

export function createUploadManager(deps: ManagerDeps): UploadManager {
  const now = deps.now ?? Date.now
  const timers: Timers = deps.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) }
  const random = deps.random ?? Math.random
  const log = deps.log ?? (() => {})
  const jobs = new Map<string, Job>()
  const listeners = new Set<() => void>()
  let running: string | null = null
  let stopped = false

  const emit = () => listeners.forEach(l => l())
  const set = (job: Job, patch: Partial<UploadState>) => { job.state = { ...job.state, ...patch }; emit() }

  // Wake on signal, foreground and sign-in: the parked job retries at once.
  deps.online.subscribe(online => { if (online) wakeAll() })
  ;(deps.onSignedIn ?? (() => noopUnsub))(() => wakeAll())

  function wakeAll() {
    for (const job of jobs.values()) job.wake?.()
  }

  /** Wait `ms`, or until woken. Resolves true when woken early. */
  function sleep(job: Job, ms: number): Promise<boolean> {
    return new Promise(resolve => {
      const handle = timers.setTimeout(() => { job.wake = null; resolve(false) }, ms)
      job.wake = () => { timers.clearTimeout(handle); job.wake = null; resolve(true) }
    })
  }

  async function runNext(): Promise<void> {
    if (running || stopped) return
    const pending = [...jobs.values()]
      .filter(j => j.state.status !== 'done' && j.state.status !== 'blocked')
      .sort((a, b) => b.savedAt - a.savedAt)
    const job = pending[0]
    if (!job) return
    running = job.betId
    try {
      await run(job)
    } finally {
      running = null
      void runNext()
    }
  }

  async function run(job: Job): Promise<void> {
    while (!stopped) {
      // Offline: wait for the network rather than spend an attempt on nothing.
      if (!deps.online.isOnline()) {
        set(job, { status: 'waiting', waitingOn: 'online', nextRetryAt: null })
        await sleep(job, 60_000)
        continue
      }
      const attempt = job.state.attempt + 1
      set(job, { status: 'preparing', attempt, waitingOn: null, nextRetryAt: null, progress: 0 })
      try {
        await attemptOnce(job)
        set(job, { status: 'done', progress: 100, waitingOn: null, nextRetryAt: null })
        await deps.store.markSealed(job.betId)
        log('upload.sealed', { bet_id: job.betId, attempts: attempt })
        return
      } catch (err) {
        const t = err instanceof TransportError ? err : new TransportError('server', err instanceof Error ? err.message : String(err))
        log('upload.attempt_failed', { bet_id: job.betId, attempt, reason: t.reason, blocked: t.blocked ?? null, message: t.message })
        if (t.reason === 'blocked') {
          set(job, { status: 'blocked', blocked: t.blocked ?? 'resolved', waitingOn: null, nextRetryAt: null, lastError: t.message })
          return
        }
        if (t.reason === 'unauthorized') {
          set(job, { status: 'waiting', waitingOn: 'auth', nextRetryAt: now() + AUTH_WAIT_MS, lastError: t.message })
          await sleep(job, AUTH_WAIT_MS)
          continue
        }
        const delay = t.reason === 'rate_limited'
          ? Math.max(t.retryAfterMs ?? 0, backoffDelay(attempt - 1, UPLOAD_BACKOFF_MS, 0.2, random))
          : backoffDelay(attempt - 1, UPLOAD_BACKOFF_MS, 0.2, random)
        set(job, { status: 'waiting', waitingOn: t.reason === 'rate_limited' ? 'rate_limit' : (t.reason === 'offline' ? 'online' : 'backoff'), nextRetryAt: now() + delay, lastError: t.message })
        await sleep(job, delay)
      }
    }
  }

  async function attemptOnce(job: Job): Promise<void> {
    // 1. Seal first: an earlier PUT may have landed with its answer lost.
    const sealed = await deps.transport.seal(job.betId)
    if (sealed.kind === 'sealed') return
    // 2. A slot with a fresh object name.
    const slot = await deps.transport.prepare(job.betId, job.mimeType, job.capture)
    if (slot.kind === 'sealed') return
    // 3. The bytes.
    set(job, { status: 'uploading', progress: 0 })
    job.abort = new AbortController()
    try {
      await deps.transport.put(slot.signedUrl, job.blob, job.mimeType, pct => set(job, { progress: pct }), job.abort.signal)
    } finally {
      job.abort = null
    }
    // 4. The hash, written once.
    set(job, { status: 'sealing', progress: 100 })
    const final = await deps.transport.seal(job.betId)
    if (final.kind === 'missing') throw new TransportError('server', 'The upload did not land')
  }

  return {
    async enqueue({ betId, blob, mimeType, capture = null, alreadyStored = false, savedAt }) {
      const at = savedAt ?? now()
      if (!alreadyStored) await deps.store.save({ betId, blob, mimeType, capture, savedAt: at, sealed: false })
      const existing = jobs.get(betId)
      if (existing) {
        if (existing.state.status === 'done') return
        existing.wake?.()
        return
      }
      jobs.set(betId, {
        betId, blob, mimeType, capture, savedAt: at,
        state: { betId, status: 'queued', progress: 0, attempt: 0, nextRetryAt: null, waitingOn: null },
        wake: null, abort: null,
      })
      emit()
      void runNext()
    },
    kick(betId) {
      for (const job of jobs.values()) {
        if (betId && job.betId !== betId) continue
        if (job.state.status === 'blocked') {
          // The golfer asked again: give it one more go.
          set(job, { status: 'queued', blocked: undefined, lastError: undefined })
        }
        job.wake?.()
      }
      void runNext()
    },
    get: betId => jobs.get(betId)?.state,
    all: () => [...jobs.values()].map(j => j.state),
    subscribe(cb) {
      listeners.add(cb)
      return () => { listeners.delete(cb) }
    },
    async recover() {
      // Newest first: the shot just taken matters more than one from yesterday.
      const records = (await deps.store.load()).sort((a, b) => b.savedAt - a.savedAt)
      let n = 0
      for (const r of records) {
        if (r.sealed) continue
        await this.enqueue({ betId: r.betId, blob: r.blob, mimeType: r.mimeType, capture: r.capture, alreadyStored: true, savedAt: r.savedAt })
        n++
      }
      return n
    },
    stopAll() {
      stopped = true
      for (const job of jobs.values()) { job.abort?.abort(); job.wake?.() }
    },
  }
}

/** Map an HTTP refusal from our API to what the manager should do with it. */
export function classifyHttp(status: number, code: string | undefined, retryAfterMs?: number): TransportError {
  if (status === 401) return new TransportError('unauthorized', 'Signed out', undefined)
  if (status === 429) return new TransportError('rate_limited', 'Too many attempts', undefined, retryAfterMs)
  if (status === 403) return new TransportError('blocked', 'Not your bet', 'not_yours')
  if (status === 410) return new TransportError('blocked', 'The footage window has closed', 'expired')
  if (status === 413) return new TransportError('blocked', 'The clip is too large', 'too_large')
  if (status === 409 && code === 'INVALID_TRANSITION') return new TransportError('blocked', 'This bet is resolved', 'resolved')
  if (status === 400 && code === 'INVALID_INPUT') return new TransportError('blocked', 'Unsupported footage', 'unsupported_type')
  if (status >= 500 || status === 408) return new TransportError('server', `Server answered ${status}`)
  return new TransportError('server', `Unexpected answer ${status}`)
}

export type { BlockedReason }
