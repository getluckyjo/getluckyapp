/**
 * The fan prize for Back an Icon: who was in the draw, and who won.
 *
 * Three R1m prizes go to fans who backed the Icon who holes it at Icons
 * Cup South Africa. Everything here is pure and deterministic, so the
 * insurer, the organisers or a fan can re-run it from the published record
 * and get the same answer:
 *
 *   1. Picks close at first tee (or earlier, when an admin freezes the
 *      list). `picksOpen()` is that rule; migration 036 enforces the same
 *      rule in the database whatever route tries to write.
 *   2. The backer list is frozen into icon_vote_snapshot and hashed:
 *      `snapshotHash()` is SHA-256 over "user_id:icon_id" lines sorted by
 *      user id. The hash is published before the shot is played, so the
 *      list cannot be edited afterwards without the hash changing.
 *   3. After the ace, the admin enters the winning Icon and a seed that
 *      could not have been known when the list was frozen (the closing
 *      number of a public index on the day, a lottery draw, or a value the
 *      organisers announce on air). Every eligible backer of that Icon gets
 *      a rank, HMAC-SHA256(seed, user_id). Sorted by rank, lowest first,
 *      the first three are the winners. `drawWinners()` is that step, and
 *      `drawHash()` seals the result.
 *
 * Nothing here talks to the database; the routes under
 * /api/admin/icons/event do, and the tests run these functions directly.
 */
import { createHash, createHmac } from 'node:crypto'

export interface IconEventState {
  first_tee_at: string | null
  frozen_at: string | null
}

/** Can a golfer still pick or change their Icon? */
export function picksOpen(event: IconEventState | null, now: Date = new Date()): boolean {
  if (!event) return true
  if (event.frozen_at) return false
  if (event.first_tee_at && now.getTime() >= Date.parse(event.first_tee_at)) return false
  return true
}

export interface Backer {
  userId: string
  iconId: string
}

/** The lines the snapshot hash is computed over: one per backer, sorted by user id. */
export function snapshotLines(rows: Backer[]): string[] {
  return [...rows]
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .map(r => `${r.userId}:${r.iconId}`)
}

/** SHA-256 (hex) of the snapshot lines joined by newlines. Order of input does not matter. */
export function snapshotHash(rows: Backer[]): string {
  return createHash('sha256').update(snapshotLines(rows).join('\n')).digest('hex')
}

/** The rank the seed gives a backer: HMAC-SHA256(seed, user_id), hex. Lower wins. */
export function drawRank(seed: string, userId: string): string {
  return createHmac('sha256', seed).update(userId).digest('hex')
}

export interface DrawnWinner {
  position: number
  userId: string
  rank: string
}

/**
 * The winners among `eligible` (user ids): rank each with the seed, sort
 * ascending by rank (then by user id, which cannot tie for distinct ids),
 * take the first `count`. Fewer eligible backers than prizes means fewer
 * winners, never a repeat.
 */
export function drawWinners(seed: string, eligible: string[], count: number): DrawnWinner[] {
  const ranked = [...new Set(eligible)]
    .map(userId => ({ userId, rank: drawRank(seed, userId) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
  return ranked.slice(0, Math.max(0, count)).map((w, i) => ({ position: i + 1, userId: w.userId, rank: w.rank }))
}

/** SHA-256 (hex) sealing a draw: the snapshot hash, the winning Icon, the seed and the winners in order. */
export function drawHash(input: { snapshotSha256: string; winningIconId: string; seed: string; winners: DrawnWinner[] }): string {
  const lines = [
    `snapshot:${input.snapshotSha256}`,
    `icon:${input.winningIconId}`,
    `seed:${input.seed}`,
    ...input.winners.map(w => `${w.position}:${w.userId}:${w.rank}`),
  ]
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

export type IneligibleReason = 'under_18' | 'staff' | 'suspended' | 'no_profile'

export interface EligibilityProfile {
  age_verified_at: string | null
  is_admin: boolean | null
  suspended_at: string | null
}

/**
 * Why a backer is out of the draw, or null when they are in. The order is
 * the order a reviewer would want to see: a missing profile first, then the
 * rules in the terms.
 */
export function ineligibleReason(profile: EligibilityProfile | null | undefined): IneligibleReason | null {
  if (!profile) return 'no_profile'
  if (profile.is_admin) return 'staff'
  if (profile.suspended_at) return 'suspended'
  if (!profile.age_verified_at) return 'under_18'
  return null
}
