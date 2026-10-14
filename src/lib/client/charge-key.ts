/**
 * One key per purchase intent, so a charge the phone has to send twice is
 * charged once.
 *
 * When the golfer taps Pay, the stake sheet mints a key for that purchase
 * (this method, this tier, this hole) and keeps it in sessionStorage. It
 * rides on the request as Idempotency-Key. The key survives a lost answer
 * (the phone retries with the same one and the server replays the first
 * outcome) and is dropped on any answer that settles the purchase, so the
 * next tap is a new charge.
 */
import { fetchJson, NetError, type FetchJsonOptions } from '@/lib/net/fetch-json'

const PREFIX = 'glg:charge-key:'

function randomKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

/** The key for this purchase, minted on first use and kept until it settles. */
export function chargeKey(scope: string): string {
  const name = PREFIX + scope
  try {
    const kept = sessionStorage.getItem(name)
    if (kept) return kept
  } catch { /* storage blocked: a fresh key per call is still one charge per request */ }
  const key = randomKey()
  try { sessionStorage.setItem(name, key) } catch { /* same */ }
  return key
}

export function clearChargeKey(scope: string): void {
  try { sessionStorage.removeItem(PREFIX + scope) } catch { /* nothing kept */ }
}

export interface Outcome<T> { status: number; data: T }

/**
 * POST a charge and give back whatever the server answered, status and
 * body, whether 200, 202, 402 or 409. Only a request that got no answer at
 * all (offline past the wait, timed out on every try, dropped) throws, as a
 * NetError, so the caller can say "no signal" rather than "declined".
 */
export async function postForOutcome<T>(url: string, body: unknown, opts: Omit<FetchJsonOptions, 'method' | 'body'> = {}): Promise<Outcome<T>> {
  try {
    return await fetchJson<T>(url, { method: 'POST', body, ...opts })
  } catch (err) {
    if (err instanceof NetError && (err.kind === 'http' || err.kind === 'rate_limited') && err.status) {
      return { status: err.status, data: (err.body ?? {}) as T }
    }
    throw err
  }
}

/** Does this answer settle the purchase, so the key can go? Only a lost answer keeps it. */
export function settlesCharge(status: number, data: { code?: string }): boolean {
  // 429 and 5xx: the request was not acted on; the same key may try again.
  if (status === 429 || status >= 500) return false
  // CHARGE_UNKNOWN: the provider went quiet; the return page settles it from
  // the ledger. A fresh key here would be a second charge.
  if (status === 409 && data.code === 'CHARGE_UNKNOWN') return false
  return true
}
