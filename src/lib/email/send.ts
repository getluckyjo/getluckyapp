/**
 * One way to send an email through Resend that survives a busy minute.
 *
 * Resend allows 10 requests a second on this account and answers 429 above
 * it. During a broadcast push the sign-in hook, the welcome queue and the
 * ops alerts all share that budget, and a single refused call used to be a
 * failed sign-in. So: a 429 or a 5xx is retried a few times with a short,
 * jittered wait, inside the Supabase hook's own timeout. A 4xx that is not
 * a rate limit (a bad address, an unverified domain) is final.
 */
import { resend } from '@/lib/resend'

type SendParams = Parameters<typeof resend.emails.send>[0]
type SendResponse = Awaited<ReturnType<typeof resend.emails.send>>

export interface RetryOptions {
  /** Total tries, including the first. */
  attempts?: number
  /** Base wait before the second try, in ms; doubles each time, with jitter. */
  baseDelayMs?: number
  /** Test hook. */
  sleep?: (ms: number) => Promise<void>
}

const RETRYABLE_NAMES = new Set(['rate_limit_exceeded', 'internal_server_error', 'application_error'])

/** Is this a refusal that a second try can fix? */
export function isRetryable(error: { name?: string; statusCode?: number | null } | null | undefined): boolean {
  if (!error) return false
  const status = error.statusCode ?? null
  if (status === 429 || (status !== null && status >= 500)) return true
  return !!error.name && RETRYABLE_NAMES.has(error.name)
}

export async function sendEmailWithRetry(params: SendParams, opts: RetryOptions = {}): Promise<SendResponse & { tries: number }> {
  const attempts = Math.max(1, opts.attempts ?? 3)
  const base = opts.baseDelayMs ?? 250
  const sleep = opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
  let last: SendResponse = { data: null, error: { name: 'application_error', message: 'not sent' } } as SendResponse
  for (let i = 1; i <= attempts; i++) {
    let res: SendResponse
    try {
      res = await resend.emails.send(params)
    } catch (err) {
      // The SDK throws on a network failure; treat it like a 5xx.
      res = { data: null, error: { name: 'application_error', message: err instanceof Error ? err.message : String(err) } } as SendResponse
    }
    if (!res.error) return { ...res, tries: i }
    last = res
    if (!isRetryable(res.error as { name?: string; statusCode?: number | null }) || i === attempts) break
    await sleep(base * 2 ** (i - 1) + Math.floor(Math.random() * base))
  }
  return { ...last, tries: attempts }
}
