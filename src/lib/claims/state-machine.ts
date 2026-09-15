/**
 * The claim state machine. Every change to a bet's or a verification's
 * status goes through here, so the rules live in one place and every
 * transition is a conditional update (`where status = <from>`) that cannot
 * be raced into a double resolution.
 *
 *   bet:   active ──player──▶ miss
 *          active ──player──▶ claimed ──review──▶ verified ──admin──▶ paid
 *
 *   verification:
 *          pending / documents_received ──▶ under_review ──▶ approved | rejected
 *          pending / documents_received ──────────────────▶ approved | rejected
 *
 * Anything else is a 409. A bet past its play window cannot leave `active`
 * (410). A suspended account cannot act on money paths (403).
 *
 * Writes use the service-role client (migration 006 removed client writes)
 * and always set `updated_by`, which the claim_events trigger records as the
 * actor. Callers do the ownership check first with the user's own client.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export const BET_STATUSES = ['active', 'miss', 'claimed', 'verified', 'paid'] as const
export type BetStatus = (typeof BET_STATUSES)[number]

export const VERIFICATION_STATUSES = ['pending', 'documents_received', 'under_review', 'approved', 'rejected'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export type BetActor = 'player' | 'review' | 'admin'

const BET_TRANSITIONS: Record<BetActor, Partial<Record<BetStatus, readonly BetStatus[]>>> = {
  player: { active: ['miss', 'claimed'] },
  review: { claimed: ['verified'] },       // only via an approved verification
  admin:  { verified: ['paid'] },          // payout confirmation
}

const VERIFICATION_TRANSITIONS: Record<VerificationStatus, readonly VerificationStatus[]> = {
  pending:            ['documents_received', 'under_review', 'approved', 'rejected'],
  documents_received: ['under_review', 'approved', 'rejected'],
  under_review:       ['approved', 'rejected'],
  approved:           [],
  rejected:           [],
}

/** Verification states in which the player may still (re)submit evidence. */
export const OPEN_VERIFICATION_STATUSES: readonly VerificationStatus[] = ['pending', 'documents_received']

export type ClaimErrorCode =
  | 'INVALID_TRANSITION'
  | 'BET_EXPIRED'
  | 'BET_NOT_FOUND'
  | 'VERIFICATION_NOT_FOUND'
  | 'ACCOUNT_SUSPENDED'
  | 'CLAIM_LOCKED'
  | 'CONFLICT'

export class ClaimError extends Error {
  constructor(public code: ClaimErrorCode, message: string, public status: number) {
    super(message)
    this.name = 'ClaimError'
  }
}

export function isBetStatus(v: unknown): v is BetStatus {
  return typeof v === 'string' && (BET_STATUSES as readonly string[]).includes(v)
}
export function isVerificationStatus(v: unknown): v is VerificationStatus {
  return typeof v === 'string' && (VERIFICATION_STATUSES as readonly string[]).includes(v)
}

export function canTransitionBet(actor: BetActor, from: BetStatus, to: BetStatus): boolean {
  return (BET_TRANSITIONS[actor][from] ?? []).includes(to)
}
export function canTransitionVerification(from: VerificationStatus, to: VerificationStatus): boolean {
  return VERIFICATION_TRANSITIONS[from].includes(to)
}

// ── Play window ─────────────────────────────────────────────────────────

const DEFAULT_WINDOW_HOURS = 24

/** Hours a bet stays open after purchase. `BET_WINDOW_HOURS` overrides; 1–168. */
export function betWindowHours(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.BET_WINDOW_HOURS)
  return Number.isFinite(n) && n >= 1 && n <= 168 ? n : DEFAULT_WINDOW_HOURS
}

export function computeExpiresAt(createdAt: Date = new Date(), env: Record<string, string | undefined> = process.env): string {
  return new Date(createdAt.getTime() + betWindowHours(env) * 3_600_000).toISOString()
}

export function isExpired(bet: { expires_at?: string | null }, now: number = Date.now()): boolean {
  if (!bet.expires_at) return false // legacy rows before migration 007; the default fills them
  const t = Date.parse(bet.expires_at)
  return Number.isFinite(t) && t <= now
}

// ── Guards ──────────────────────────────────────────────────────────────

/** Throws ACCOUNT_SUSPENDED if the caller's profile is suspended. Use the caller's own client. */
export async function assertNotSuspended(userClient: SupabaseClient, userId: string): Promise<void> {
  const { data } = await userClient.from('profiles').select('suspended_at').eq('id', userId).maybeSingle()
  if (data?.suspended_at) {
    throw new ClaimError('ACCOUNT_SUSPENDED', 'This account is suspended. Please contact support.', 403)
  }
}

export function assertOpen(bet: { status: string; expires_at?: string | null }): void {
  if (bet.status !== 'active') {
    throw new ClaimError('INVALID_TRANSITION', `This bet is already ${bet.status}.`, 409)
  }
  if (isExpired(bet)) {
    throw new ClaimError('BET_EXPIRED', 'The play window for this bet has closed.', 410)
  }
}

// ── Writes ──────────────────────────────────────────────────────────────

export interface BetTransition {
  betId: string
  from: BetStatus
  to: BetStatus
  actor: BetActor
  /** auth.users id of whoever is acting; recorded as claim_events.actor_id. */
  actorId: string
  /** When set, the update is additionally scoped to this owner. */
  userId?: string
  extra?: Record<string, unknown>
}

/**
 * Conditional status change: `update ... where id = $betId and status = $from`.
 * Zero rows means someone else got there first (or the caller's read was
 * stale) and is reported as a 409 rather than silently overwriting.
 */
export async function transitionBet(admin: SupabaseClient, t: BetTransition): Promise<void> {
  if (!canTransitionBet(t.actor, t.from, t.to)) {
    throw new ClaimError('INVALID_TRANSITION', `A ${t.actor} cannot move a bet from ${t.from} to ${t.to}.`, 409)
  }

  let query = admin
    .from('bets')
    .update({ status: t.to, updated_by: t.actorId, ...(t.extra ?? {}) })
    .eq('id', t.betId)
    .eq('status', t.from)
  if (t.userId) query = query.eq('user_id', t.userId)

  const { data, error } = await query.select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new ClaimError('CONFLICT', 'The bet changed before this request was applied. Reload and try again.', 409)
  }
}

export interface Review {
  verificationId: string
  to: VerificationStatus
  actorId: string
  notes?: string
}

/**
 * Admin review. Checks the verification transition, and for an approval also
 * that the bet is still `claimed`, then applies verification and bet updates
 * (verification first, conditionally; then the bet). Returns the bet id.
 */
export async function reviewVerification(admin: SupabaseClient, r: Review): Promise<{ betId: string }> {
  const { data: v } = await admin
    .from('verifications')
    .select('id, status, bet_id')
    .eq('id', r.verificationId)
    .maybeSingle()
  if (!v) throw new ClaimError('VERIFICATION_NOT_FOUND', 'Verification not found', 404)

  const from = v.status as VerificationStatus
  if (!isVerificationStatus(from) || !canTransitionVerification(from, r.to)) {
    throw new ClaimError('INVALID_TRANSITION', `Cannot move a verification from ${v.status} to ${r.to}.`, 409)
  }

  if (r.to === 'approved') {
    const { data: bet } = await admin.from('bets').select('id, status').eq('id', v.bet_id).maybeSingle()
    if (!bet) throw new ClaimError('BET_NOT_FOUND', 'Bet not found', 404)
    if (bet.status !== 'claimed') {
      throw new ClaimError('INVALID_TRANSITION', `Cannot approve: the bet is ${bet.status}, not claimed.`, 409)
    }
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    status: r.to,
    reviewed_by: r.actorId,
    updated_by: r.actorId,
    ...(r.notes !== undefined ? { reviewer_notes: r.notes } : {}),
    ...(r.to === 'approved' ? { verified_at: now } : {}),
  }

  const { data: updated, error } = await admin
    .from('verifications')
    .update(updates)
    .eq('id', r.verificationId)
    .eq('status', from)
    .select('id')
  if (error) throw error
  if (!updated || updated.length === 0) {
    throw new ClaimError('CONFLICT', 'The verification changed before this request was applied.', 409)
  }

  if (r.to === 'approved') {
    await transitionBet(admin, { betId: v.bet_id as string, from: 'claimed', to: 'verified', actor: 'review', actorId: r.actorId })
  }

  return { betId: v.bet_id as string }
}

// ── HTTP ────────────────────────────────────────────────────────────────

export function claimErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof ClaimError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
  }
  return null
}
