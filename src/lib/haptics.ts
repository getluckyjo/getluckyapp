/**
 * Haptic feedback for the moments that deserve it: a bet is live, a claim
 * is in, the shot missed. Feature-detected; iOS Safari has no vibrate API
 * and silently gets nothing, which is fine.
 *
 * Keep the patterns short. Anything over ~40 ms reads as an alarm.
 */
type Pattern = number | number[]

function vibrate(pattern: Pattern): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(pattern)
  } catch {
    // Some browsers throw when the page has not been interacted with. Ignore.
  }
}

export const haptics = {
  /** A light tick: tab change, toggle, sheet open. */
  tap: () => vibrate(10),
  /** Two quick pulses: something was confirmed (payment, claim submitted). */
  success: () => vibrate([14, 60, 14]),
  /** One firmer pulse: an error the golfer must act on. */
  warn: () => vibrate(30),
}
