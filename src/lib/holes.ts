/**
 * Which holes the challenge can be played on.
 *
 * A hole qualifies when it is a par 3 of at least MIN_HOLE_METRES (140 m,
 * set by Johannes on 16 September 2026: "only par 3s over 140 m", with
 * 140 m itself counting). Shorter par 3s stay listed so a golfer standing
 * on one sees why it is not offered, but checkout refuses them and the
 * select-course screen will not continue with one.
 *
 * A hole with no distance on record does not qualify: the length is the
 * eligibility, so an unknown length cannot pass. Admin → Courses sets it.
 */
export const MIN_HOLE_METRES = 140

export interface HoleLike {
  par: number
  distance_metres: number | null
}

export function isHolePlayable(hole: HoleLike): boolean {
  return hole.par === 3 && hole.distance_metres !== null && hole.distance_metres >= MIN_HOLE_METRES
}

/** Why a hole is not offered, for the UI and the checkout error. */
export function holeUnavailableReason(hole: HoleLike): string | null {
  if (isHolePlayable(hole)) return null
  if (hole.par !== 3) return `Par ${hole.par}`
  if (hole.distance_metres === null) return 'Distance not set'
  return `Under ${MIN_HOLE_METRES}m`
}
