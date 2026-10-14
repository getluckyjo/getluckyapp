/**
 * Is the phone on the network, as far as the browser can tell, and a way to
 * wait for it to come back.
 *
 * `navigator.onLine` is a weak signal (true on a Wi-Fi with no internet) but
 * false is reliable: airplane mode, no bars. The upload manager and the
 * fetch helper read it before an attempt and wait for 'online' rather than
 * burning a retry into a dead link. Everything is injectable so the tests
 * run under node with no window.
 */

export interface OnlineSource {
  isOnline(): boolean
  /** Subscribe to online/offline changes; returns the unsubscribe. */
  subscribe(cb: (online: boolean) => void): () => void
}

const listeners = new Set<(online: boolean) => void>()
let bound = false

function bind() {
  if (bound || typeof window === 'undefined') return
  bound = true
  window.addEventListener('online', () => listeners.forEach(l => l(true)))
  window.addEventListener('offline', () => listeners.forEach(l => l(false)))
}

/** The browser's own view. Server-side (no navigator) it is always online. */
export const browserOnline: OnlineSource = {
  isOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false
  },
  subscribe(cb) {
    bind()
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  },
}

/**
 * Resolve when the source says online, or after `maxMs` either way (a stale
 * `false` must not hold a request for ever). Resolves at once when already
 * online. Returns whether the network came back in time.
 */
export function whenOnline(source: OnlineSource = browserOnline, maxMs = 30_000, timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = globalThis): Promise<boolean> {
  if (source.isOnline()) return Promise.resolve(true)
  return new Promise(resolve => {
    let unsub = () => {}
    const timer = timers.setTimeout(() => { unsub(); resolve(source.isOnline()) }, maxMs)
    unsub = source.subscribe(online => {
      if (!online) return
      timers.clearTimeout(timer)
      unsub()
      resolve(true)
    })
  })
}

// ── Slow-link signal ──────────────────────────────────────────────────────
// fetchJson reports timeouts here; the network banner reads the streak.
let timeoutStreak = 0
const streakListeners = new Set<(n: number) => void>()

export function noteRequestOutcome(timedOut: boolean): void {
  timeoutStreak = timedOut ? timeoutStreak + 1 : 0
  streakListeners.forEach(l => l(timeoutStreak))
}
export function timeoutStreakCount(): number {
  return timeoutStreak
}
export function subscribeTimeoutStreak(cb: (n: number) => void): () => void {
  streakListeners.add(cb)
  return () => { streakListeners.delete(cb) }
}
