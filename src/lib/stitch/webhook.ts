/**
 * Stitch webhooks arrive through Svix. Each is signed: HMAC-SHA256 over
 * "<svix-id>.<svix-timestamp>.<raw body>" with the base64 part of the
 * whsec_ secret, base64-encoded, in the svix-signature header as one or
 * more "v1,<sig>" entries (several while a secret rotates). A timestamp
 * more than five minutes off is a replay or a broken clock; refused.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const WEBHOOK_TOLERANCE_MS = 5 * 60_000

export interface SvixHeaders {
  'svix-id'?: string | null
  'svix-timestamp'?: string | null
  'svix-signature'?: string | null
}

export type SvixVerdict = { ok: true; id: string } | { ok: false; reason: 'missing_headers' | 'bad_timestamp' | 'bad_signature' | 'bad_secret' }

export function verifySvixSignature(secret: string, headers: SvixHeaders, rawBody: string, now: number = Date.now()): SvixVerdict {
  const id = headers['svix-id']?.trim()
  const ts = headers['svix-timestamp']?.trim()
  const sigHeader = headers['svix-signature']?.trim()
  if (!id || !ts || !sigHeader) return { ok: false, reason: 'missing_headers' }

  const seconds = Number(ts)
  if (!Number.isFinite(seconds) || Math.abs(now - seconds * 1000) > WEBHOOK_TOLERANCE_MS) return { ok: false, reason: 'bad_timestamp' }

  const b64 = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  let key: Buffer
  try {
    key = Buffer.from(b64, 'base64')
  } catch {
    return { ok: false, reason: 'bad_secret' }
  }
  if (key.length === 0) return { ok: false, reason: 'bad_secret' }

  const expected = createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest()
  const candidates = sigHeader.split(/\s+/).map(part => part.split(',')[1]).filter((s): s is string => !!s)
  for (const candidate of candidates) {
    let given: Buffer
    try {
      given = Buffer.from(candidate, 'base64')
    } catch {
      continue
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true, id }
  }
  return { ok: false, reason: 'bad_signature' }
}

/** The shape of a Stitch `transaction` webhook we act on. Anything else is acknowledged and ignored. */
export interface StitchTransactionEvent {
  id: string
  type: string
  datetime?: string
  data: {
    id: string
    externalReference?: string | null
    nonce?: string | null
    status: string
    statusReason?: string | null
    reasonDescription?: string | null
    amount?: { quantity?: string | number; currency?: string } | null
    type?: string | null
    retrievalReferenceNumber?: string | null
  }
}

export function parseTransactionEvent(body: unknown): StitchTransactionEvent | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.type !== 'transaction' || typeof b.id !== 'string') return null
  const data = b.data
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (typeof d.id !== 'string' || typeof d.status !== 'string') return null
  return b as unknown as StitchTransactionEvent
}

/** A Stitch `payment-consent-request` webhook: the card on file was granted, revoked, expired or failed. */
export interface StitchConsentEvent {
  id: string
  type: 'payment-consent-request'
  data: {
    id: string
    status: string
    nonce?: string | null
    card?: unknown
  }
}

export function parseConsentEvent(body: unknown): StitchConsentEvent | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.type !== 'payment-consent-request' || typeof b.id !== 'string') return null
  const data = b.data
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (typeof d.id !== 'string' || typeof d.status !== 'string') return null
  return b as unknown as StitchConsentEvent
}
