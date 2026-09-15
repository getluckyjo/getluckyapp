/**
 * Salted hashes for the identifiers the risk rules cluster on: IP address,
 * user agent, email. Salted so the stored value cannot be reversed by
 * hashing the (small) IPv4 space; the same salt everywhere so two records
 * of the same address match.
 *
 * Without RISK_HASH_SALT nothing is hashed: the columns stay null and the
 * rules that need them stay quiet. That is logged once per process rather
 * than on every request.
 */
import { createHash } from 'node:crypto'
import { log } from '@/lib/observability/log'

export type HashKind = 'ip' | 'ua' | 'email'

let warned = false

export function riskSalt(env: Record<string, string | undefined> = process.env): string | null {
  const salt = env.RISK_HASH_SALT?.trim()
  return salt && salt.length >= 16 ? salt : null
}

export function hashIdentifier(kind: HashKind, value: string | null | undefined, env: Record<string, string | undefined> = process.env): string | null {
  const salt = riskSalt(env)
  if (!salt) {
    if (!warned) {
      warned = true
      log.error('risk.salt_missing', 'RISK_HASH_SALT is unset or shorter than 16 characters; no identifiers are being hashed and the shared_ip, shared_device and deleted_and_back rules cannot fire')
    }
    return null
  }
  const v = (value ?? '').trim().toLowerCase()
  if (!v || v === 'unknown') return null
  return createHash('sha256').update(`${salt}\n${kind}\n${v}`).digest('hex')
}

/** Test hook: forget that the missing-salt warning was already logged. */
export function _resetSaltWarning(): void { warned = false }
