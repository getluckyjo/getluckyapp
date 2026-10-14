/**
 * fetchJson: one timeout per attempt, retries only where safe, 429 honours
 * Retry-After, failures classified so a screen can say the right thing.
 */
import { describe, it, expect, vi } from 'vitest'
import { NetError, fetchJson, netErrorMessage } from '@/lib/net/fetch-json'
import type { OnlineSource } from '@/lib/net/online'
import { backoffDelay } from '@/lib/net/backoff'

const online: OnlineSource = { isOnline: () => true, subscribe: () => () => {} }
const noSleep = async () => {}
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('fetchJson', () => {
  it('returns status and parsed body on success and sends JSON with the right headers', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('k1')
      expect(init.body).toBe('{"a":1}')
      return reply(200, { ok: true })
    })
    const r = await fetchJson<{ ok: boolean }>('/x', { method: 'POST', body: { a: 1 }, idempotencyKey: 'k1', fetchImpl: fetchImpl as never, online, sleep: noSleep })
    expect(r).toEqual({ status: 200, data: { ok: true } })
  })

  it('a timed-out attempt is kind timeout; a GET retries it twice then gives up', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const err = await fetchJson('/slow', { timeoutMs: 5, fetchImpl: fetchImpl as never, online, sleep: noSleep }).catch(e => e)
    expect(err).toBeInstanceOf(NetError)
    expect(err.kind).toBe('timeout')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('a dropped connection is network (or offline when the browser says so); a POST without a key is not retried', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    const err = await fetchJson('/x', { method: 'POST', body: {}, fetchImpl: fetchImpl as never, online, sleep: noSleep }).catch(e => e)
    expect(err.kind).toBe('network')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const off: OnlineSource = { isOnline: () => false, subscribe: () => () => {} }
    const e2 = await fetchJson('/x', { method: 'POST', body: {}, fetchImpl: fetchImpl as never, online: off, sleep: noSleep, waitForOnlineMs: 0 }).catch(e => e)
    expect(e2.kind).toBe('offline')
  })

  it('a POST with retries set, or an idempotency key, is retried on transient failures and not on 4xx', async () => {
    let n = 0
    const flaky = vi.fn(async () => (++n < 3 ? reply(503, { error: 'busy' }) : reply(200, { done: true })))
    const r = await fetchJson('/x', { method: 'POST', body: {}, retries: 3, fetchImpl: flaky as never, online, sleep: noSleep })
    expect(r.data).toEqual({ done: true })
    expect(flaky).toHaveBeenCalledTimes(3)

    const refused = vi.fn(async () => reply(409, { error: 'Already', code: 'FOOTAGE_SEALED' }))
    const err = await fetchJson('/x', { method: 'POST', body: {}, idempotencyKey: 'k', fetchImpl: refused as never, online, sleep: noSleep }).catch(e => e)
    expect(err.kind).toBe('http')
    expect(err.status).toBe(409)
    expect(err.code).toBe('FOOTAGE_SEALED')
    expect(err.transient).toBe(false)
    expect(refused).toHaveBeenCalledTimes(1)
  })

  it('429 is rate_limited and waits at least Retry-After before the next try', async () => {
    const waits: number[] = []
    let n = 0
    const limited = vi.fn(async () => (++n === 1 ? reply(429, { error: 'Too many', code: 'RATE_LIMITED', retryAfter: 7 }, { 'Retry-After': '7' }) : reply(200, { ok: 1 })))
    const r = await fetchJson('/x', { fetchImpl: limited as never, online, sleep: async ms => { waits.push(ms) } })
    expect(r.data).toEqual({ ok: 1 })
    expect(waits).toEqual([7000])
  })

  it('waits for the browser to come online before an attempt, and fails offline when it never does', async () => {
    let isOn = false
    const subs: ((o: boolean) => void)[] = []
    const src: OnlineSource = { isOnline: () => isOn, subscribe: cb => { subs.push(cb); return () => {} } }
    const fetchImpl = vi.fn(async () => reply(200, { ok: 1 }))
    const p = fetchJson('/x', { fetchImpl: fetchImpl as never, online: src, sleep: noSleep, waitForOnlineMs: 1000 })
    await Promise.resolve()
    expect(fetchImpl).not.toHaveBeenCalled()
    isOn = true
    subs.forEach(cb => cb(true))
    expect((await p).data).toEqual({ ok: 1 })

    const never: OnlineSource = { isOnline: () => false, subscribe: () => () => {} }
    const err = await fetchJson('/x', { method: 'POST', body: {}, fetchImpl: fetchImpl as never, online: never, sleep: noSleep, waitForOnlineMs: 1 }).catch(e => e)
    expect(err.kind).toBe('offline')
  })

  it('speaks to the golfer by kind', () => {
    expect(netErrorMessage(new NetError('offline', 'x'))).toMatch(/No connection/)
    expect(netErrorMessage(new NetError('timeout', 'x'))).toMatch(/slow/)
    expect(netErrorMessage(new NetError('http', 'Card declined', 402))).toBe('Card declined')
    expect(netErrorMessage(new Error('boom'))).toBe('boom')
  })
})

describe('backoffDelay', () => {
  it('walks the schedule, repeats the last entry, and jitters within the band', () => {
    const s = [1000, 3000, 8000]
    expect(backoffDelay(0, s, 0)).toBe(1000)
    expect(backoffDelay(2, s, 0)).toBe(8000)
    expect(backoffDelay(9, s, 0)).toBe(8000)
    expect(backoffDelay(0, s, 0.2, () => 0)).toBe(800)
    expect(backoffDelay(0, s, 0.2, () => 1)).toBe(1200)
    expect(backoffDelay(0, [], 0)).toBe(0)
  })
})
