/**
 * Promo codes (migration 027): each one is worth one extra free swing per
 * golfer, until its uses run out, its date passes or an admin switches it
 * off. Made at /admin/promos, played through /api/bets/promo.
 *
 * The database holds every rule: a unique index for one use per golfer, a
 * check constraint tying the code to the promo tier, and a trigger that
 * locks the code while it counts its uses. What is here is the same rules
 * said once in TypeScript, for the friendly answer before the insert and
 * for the admin list, and how a refusal from that trigger reads when it
 * comes back through PostgREST.
 *
 * Nothing here imports server code, so the admin page can share the types.
 */

/** A stored code: capitals, digits and dashes. Mirrors the table's check. */
export const PROMO_CODE_PATTERN = /^[A-Z0-9-]{4,40}$/

/** As typed → as stored. Case and spaces do not matter to a golfer. */
export function normalisePromoCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase()
}

/** Eight characters from an alphabet with no 0/O or 1/I/L, e.g. "7K4M9P2X". */
export function generatePromoCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

/** The reference a promo bet carries. Deterministic per code and golfer, so
 *  the unique index on payment_intent_id is a second lock on "one each". */
export function promoSwingReference(codeId: string, userId: string): string {
  return `promo_${codeId}_${userId}`
}

export interface PromoCodeRow {
  id: string
  code: string
  max_uses: number
  expires_at: string
  note: string | null
  disabled_at: string | null
  created_at: string
}

/** Every reason a golfer can be turned away with a code. */
export type PromoRefusal =
  | 'PROMO_CODE_INVALID'
  | 'PROMO_CODE_DISABLED'
  | 'PROMO_CODE_EXPIRED'
  | 'PROMO_CODE_EXHAUSTED'
  | 'PROMO_CODE_USED'

/** What the golfer is told for each, and with which status. */
export const PROMO_REFUSALS: Record<PromoRefusal, { status: number; error: string }> = {
  PROMO_CODE_INVALID:   { status: 404, error: 'That code is not valid. Check it and try again.' },
  PROMO_CODE_DISABLED:  { status: 409, error: 'That code is no longer active.' },
  PROMO_CODE_EXPIRED:   { status: 409, error: 'That code has expired.' },
  PROMO_CODE_EXHAUSTED: { status: 409, error: 'Every swing on that code has been taken.' },
  PROMO_CODE_USED:      { status: 409, error: 'You have already played the free swing from this code.' },
}

/** The refusals the migration 027 trigger raises, as its message. */
const TRIGGER_REFUSALS = new Set<PromoRefusal>(['PROMO_CODE_INVALID', 'PROMO_CODE_DISABLED', 'PROMO_CODE_EXPIRED', 'PROMO_CODE_EXHAUSTED'])

/** Why this code cannot be played now, checked in the trigger's order; null when it can. */
export function codeRefusal(
  code: Pick<PromoCodeRow, 'max_uses' | 'expires_at' | 'disabled_at'>,
  uses: number,
  now: number = Date.now(),
): PromoRefusal | null {
  if (code.disabled_at) return 'PROMO_CODE_DISABLED'
  if (Date.parse(code.expires_at) <= now) return 'PROMO_CODE_EXPIRED'
  if (uses >= code.max_uses) return 'PROMO_CODE_EXHAUSTED'
  return null
}

/** The trigger's refusal, when that is what an insert error is. */
export function refusalFromDbError(err: { code?: string; message?: string } | null | undefined): PromoRefusal | null {
  if (err?.code !== 'P0001' || !err.message) return null
  return TRIGGER_REFUSALS.has(err.message as PromoRefusal) ? (err.message as PromoRefusal) : null
}

// ── The admin list ──────────────────────────────────────────────────────

export type PromoStatus = 'active' | 'disabled' | 'expired' | 'used_up'

export interface PromoUsage { uses: number; claimed: number; converted: number }

export interface AdminPromo {
  id: string
  code: string
  maxUses: number
  uses: number
  remaining: number
  /** Promo swings on this code that became a claim. */
  claimed: number
  /** Golfers who used this code and have staked real money since. */
  converted: number
  expiresAt: string
  disabledAt: string | null
  note: string | null
  status: PromoStatus
  createdAt: string
}

export function toAdminPromo(row: PromoCodeRow, usage: PromoUsage | undefined, now: number = Date.now()): AdminPromo {
  const uses = usage?.uses ?? 0
  const refusal = codeRefusal(row, uses, now)
  return {
    id: row.id,
    code: row.code,
    maxUses: row.max_uses,
    uses,
    remaining: Math.max(row.max_uses - uses, 0),
    claimed: usage?.claimed ?? 0,
    converted: usage?.converted ?? 0,
    expiresAt: row.expires_at,
    disabledAt: row.disabled_at,
    note: row.note,
    status: refusal === 'PROMO_CODE_DISABLED' ? 'disabled'
      : refusal === 'PROMO_CODE_EXPIRED' ? 'expired'
      : refusal === 'PROMO_CODE_EXHAUSTED' ? 'used_up'
      : 'active',
    createdAt: row.created_at,
  }
}
