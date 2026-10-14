/**
 * When footage may still arrive for a bet.
 *
 * The play window (`expires_at`) bounds when a shot may be TAKEN. The
 * footage of a shot taken inside it can reach us later: a golfer on a
 * course with no signal declares a miss at the tee and the video uploads
 * from the clubhouse an hour on, or from home that evening. So a bet that
 * is active, a recorded miss, or a claim may receive footage until a grace
 * period after the window, and a resolved bet (verified, paid, rejected,
 * expired) may not.
 */
import { ClaimError } from './state-machine'

/** How long after the play window closes the phone may still deliver the shot. */
export const FOOTAGE_UPLOAD_GRACE_MS = 7 * 24 * 3_600_000

const UPLOADABLE_STATUSES: readonly string[] = ['active', 'miss', 'claimed']

export function footageUploadable(bet: { status: string; expires_at?: string | null }, now: number = Date.now()): boolean {
  if (!UPLOADABLE_STATUSES.includes(bet.status)) return false
  if (!bet.expires_at) return true
  const t = Date.parse(bet.expires_at)
  return !Number.isFinite(t) || now < t + FOOTAGE_UPLOAD_GRACE_MS
}

export function assertFootageUploadable(bet: { status: string; expires_at?: string | null }, now: number = Date.now()): void {
  if (!UPLOADABLE_STATUSES.includes(bet.status)) {
    throw new ClaimError('INVALID_TRANSITION', `This bet is already ${bet.status}.`, 409)
  }
  if (!footageUploadable(bet, now)) {
    throw new ClaimError('FOOTAGE_WINDOW_CLOSED', 'The time to upload footage for this bet has passed.', 410)
  }
}
