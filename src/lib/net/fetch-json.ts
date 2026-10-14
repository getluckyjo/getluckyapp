/**
 * One way to call our API from the browser on a golf course.
 *
 *   const { status, data } = await fetchJson<Bet>('/api/bets/x', { method: 'PATCH', body, retries: 3 })
 *
 * Every attempt has a timeout (the browser's own is minutes). A request that
 * fails for a reason that may pass (offline, dropped, timed out, 429, 5xx)
 * is retried with backoff, but only when retrying is safe: GET, or the
 * caller said so (`retries`, asserting the server is idempotent), or an
 * Idempotency-Key is sent. Before each attempt, if the browser says it is
 * offline, the call waits for 'online' rather than failing at once.
 *
 * Failures are thrown as NetError with a `kind` the screens can act on, and
 * the body's `code` when the server sent one. 401/403/409/410 and other 4xx
 * are never retried: they are answers, not weather.
 */
import { backoffDelay } from './backoff'
import { browserOnline, noteRequestOutcome, whenOnline, type OnlineSource } from './online'

export type NetErrorKind = 'offline' | 'timeout' | 'network' | 'http' | 'rate_limited' | 'aborted'

export class NetError extends Error {
  constructor(
    public kind: NetErrorKind,
    message: string,
    public status?: number,
    public code?: string,
    public body?: unknown,
    public retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'NetError'
  }
  /** A reason that may pass with time or signal. */
  get transient(): boolean {
    return this.kind === 'offline' || this.kind === 'network' || this.kind === 'timeout' || this.kind === 'rate_limited'
      || (this.kind === 'http' && (this.status === 408 || (this.status ?? 0) >= 500))
  }
}

export interface FetchJsonOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  /** Per attempt. */
  timeoutMs?: number
  /** Extra attempts after the first. GET defaults to 2, everything else to 0. Setting it on a POST asserts the server is idempotent. */
  retries?: number
  backoffMs?: readonly number[]
  /** Sent as Idempotency-Key; also makes the request safe to retry. */
  idempotencyKey?: string
  /** Before each attempt, wait this long for the browser to come online. 0 disables. */
  waitForOnlineMs?: number
  signal?: AbortSignal
  /** Tests. */
  fetchImpl?: typeof fetch
  online?: OnlineSource
  sleep?: (ms: number) => Promise<void>
}

export interface FetchJsonResult<T> { status: number; data: T }

const DEFAULT_BACKOFF = [1_000, 3_000, 8_000] as const

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

function retryAfterMsOf(res: Response, body: unknown): number | undefined {
  const header = res.headers.get('Retry-After')
  const fromHeader = header ? Number(header) : NaN
  if (Number.isFinite(fromHeader)) return Math.max(0, fromHeader * 1000)
  const fromBody = body && typeof body === 'object' ? (body as { retryAfter?: unknown }).retryAfter : undefined
  return typeof fromBody === 'number' ? Math.max(0, fromBody * 1000) : undefined
}

export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<FetchJsonResult<T>> {
  const method = opts.method ?? 'GET'
  const retries = opts.retries ?? (method === 'GET' ? 2 : 0)
  const canRetry = method === 'GET' || opts.retries !== undefined || !!opts.idempotencyKey
  const timeoutMs = opts.timeoutMs ?? 15_000
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF
  const waitMs = opts.waitForOnlineMs ?? 30_000
  const fetchImpl = opts.fetchImpl ?? fetch
  const online = opts.online ?? browserOnline
  const sleep = opts.sleep ?? defaultSleep

  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey

  let last: NetError | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new NetError('aborted', 'Request aborted')
    if (waitMs > 0 && !online.isOnline()) {
      const back = await whenOnline(online, waitMs)
      if (!back) {
        last = new NetError('offline', 'No connection')
        if (!canRetry || attempt === retries) throw last
        continue
      }
    }

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    const onOuterAbort = () => controller.abort()
    opts.signal?.addEventListener('abort', onOuterAbort, { once: true })
    try {
      const res = await fetchImpl(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        credentials: 'same-origin',
      })
      const body = await readBody(res)
      noteRequestOutcome(false)
      if (res.ok) return { status: res.status, data: body as T }
      const code = body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string' ? (body as { code: string }).code : undefined
      const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : `Request failed (${res.status})`
      if (res.status === 429) last = new NetError('rate_limited', message, 429, code ?? 'RATE_LIMITED', body, retryAfterMsOf(res, body))
      else last = new NetError('http', message, res.status, code, body)
    } catch (err) {
      if (opts.signal?.aborted) throw new NetError('aborted', 'Request aborted')
      if (timedOut) { noteRequestOutcome(true); last = new NetError('timeout', 'The request took too long') }
      else last = new NetError(online.isOnline() ? 'network' : 'offline', err instanceof Error && err.message ? err.message : 'Network error')
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onOuterAbort)
    }

    if (!last.transient || !canRetry || attempt === retries) throw last
    const wait = Math.max(backoffDelay(attempt, backoff), last.retryAfterMs ?? 0)
    await sleep(wait)
  }
  throw last ?? new NetError('network', 'Network error')
}

/** The message a screen shows for a NetError, in the app's voice. */
export function netErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!(err instanceof NetError)) return err instanceof Error && err.message ? err.message : fallback
  switch (err.kind) {
    case 'offline': return 'No connection. We’ll keep trying when your signal returns.'
    case 'timeout': return 'The connection is slow. Please try again.'
    case 'network': return 'Could not reach Get Lucky. Check your signal and try again.'
    case 'rate_limited': return 'Too many tries in a row. Give it a moment.'
    default: return err.message || fallback
  }
}
