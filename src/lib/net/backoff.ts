/**
 * How long to wait before attempt `n` (0-based) of something that failed.
 * The schedule's last entry repeats for ever; jitter spreads a field of
 * phones that all lost signal at the same tee.
 */
export function backoffDelay(attempt: number, schedule: readonly number[], jitter = 0.2, random: () => number = Math.random): number {
  if (schedule.length === 0) return 0
  const base = schedule[Math.min(Math.max(attempt, 0), schedule.length - 1)]
  const spread = base * jitter
  return Math.max(0, Math.round(base - spread + random() * 2 * spread))
}
