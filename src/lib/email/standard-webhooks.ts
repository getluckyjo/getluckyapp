import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verifies a Standard Webhooks signature (https://www.standardwebhooks.com/),
 * the scheme Supabase Auth Hooks sign their HTTP payloads with.
 *
 * Headers: `webhook-id`, `webhook-timestamp` (unix seconds), `webhook-signature`
 * (one or more space-separated `v1,<base64>` entries). The signed content is
 * `${id}.${timestamp}.${rawBody}` with HMAC-SHA256 keyed by the secret's bytes.
 * Supabase presents the secret as `v1,whsec_<base64 key>`.
 *
 * Implemented directly rather than pulling in a package: it is thirty lines
 * and the contract is stable.
 */

export const DEFAULT_TOLERANCE_SECONDS = 5 * 60

export function parseSecret(secret: string): Buffer {
  let s = secret.trim()
  if (s.startsWith('v1,')) s = s.slice(3)
  if (s.startsWith('whsec_')) s = s.slice(6)
  return Buffer.from(s, 'base64')
}

export function sign(secret: string, id: string, timestamp: string | number, body: string): string {
  const key = parseSecret(secret)
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
}

export type VerifyResult = { ok: true } | { ok: false; reason: string }

export function verifyStandardWebhook(
  params: {
    secret: string
    body: string
    headers: { id?: string | null; timestamp?: string | null; signature?: string | null }
    now?: number
    toleranceSeconds?: number
  },
): VerifyResult {
  const { secret, body } = params
  const id = params.headers.id ?? ''
  const timestamp = params.headers.timestamp ?? ''
  const signatureHeader = params.headers.signature ?? ''

  if (!secret) return { ok: false, reason: 'no secret configured' }
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: 'missing signature headers' }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad timestamp' }
  const now = params.now ?? Math.floor(Date.now() / 1000)
  const tolerance = params.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  if (Math.abs(now - ts) > tolerance) return { ok: false, reason: 'timestamp outside tolerance' }

  const expected = Buffer.from(sign(secret, id, timestamp, body), 'base64')

  for (const entry of signatureHeader.split(' ')) {
    const [version, sig] = entry.split(',')
    if (version !== 'v1' || !sig) continue
    const given = Buffer.from(sig, 'base64')
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      return { ok: true }
    }
  }
  return { ok: false, reason: 'signature mismatch' }
}
