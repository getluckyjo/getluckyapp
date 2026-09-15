/**
 * Capture attestation: what the recorder reports about the moment the
 * footage was made, and the checks the server runs on it before storing it
 * on the bet (docs/stage-4-proposal.md §1.2).
 *
 * Nothing here blocks a claim. The values are stored so the reviewer can
 * compare them with the footage and with the bet's own timeline; Batch 10
 * turns the disagreements into flags. Location is flag-only by decision.
 *
 * Safe to import from the browser: zod and arithmetic, no server imports.
 */
import { z } from 'zod'

/** The recorder caps at 120 s; allow a little for the last chunk. */
export const MAX_RECORDING_MS = 130_000
/** How far in the future a device clock may be before its timestamps are dropped. */
const CLOCK_SKEW_MS = 5 * 60_000
/** How old a recording may be, relative to the request, before its timestamps are dropped. */
const MAX_CAPTURE_AGE_MS = 48 * 3_600_000

export const CaptureSchema = z.object({
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  durationMs: z.number().int().min(0).max(MAX_RECORDING_MS),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().min(0).max(100_000).optional(),
})

export type CaptureInput = z.infer<typeof CaptureSchema>

export interface CaptureColumns {
  capture_started_at: string | null
  capture_ended_at: string | null
  capture_duration_ms: number | null
  capture_lat: number | null
  capture_lng: number | null
  capture_accuracy_m: number | null
  capture_distance_m: number | null
  capture_user_agent: string | null
}

export interface CoursePoint { lat: number | null; lng: number | null }

/**
 * Turn a validated capture report into bet columns. Timestamps that cannot
 * be true (end before start, duration off from the timestamps by more than
 * a few seconds, far in the future, or older than two days) are dropped
 * rather than stored, so a reviewer never sees a plausible-looking lie;
 * the absence is itself visible. A position is kept whenever it is
 * present; the distance to the course is computed when both are known.
 */
export function captureColumns(input: CaptureInput | undefined, opts: { course: CoursePoint | null; userAgent: string | null; now?: number }): CaptureColumns {
  const ua = opts.userAgent ? opts.userAgent.slice(0, 300) : null
  const empty: CaptureColumns = {
    capture_started_at: null, capture_ended_at: null, capture_duration_ms: null,
    capture_lat: null, capture_lng: null, capture_accuracy_m: null, capture_distance_m: null,
    capture_user_agent: ua,
  }
  if (!input) return empty

  const now = opts.now ?? Date.now()
  const started = Date.parse(input.startedAt)
  const ended = Date.parse(input.endedAt)
  const span = ended - started
  const timelineOk =
    Number.isFinite(started) && Number.isFinite(ended)
    && span >= 0 && span <= MAX_RECORDING_MS + 5_000
    && Math.abs(span - input.durationMs) <= 5_000
    && ended <= now + CLOCK_SKEW_MS
    && started >= now - MAX_CAPTURE_AGE_MS

  const hasPosition = typeof input.lat === 'number' && typeof input.lng === 'number'
  const distance = hasPosition && opts.course && typeof opts.course.lat === 'number' && typeof opts.course.lng === 'number'
    ? Math.round(distanceMetres({ lat: input.lat as number, lng: input.lng as number }, { lat: opts.course.lat, lng: opts.course.lng }))
    : null

  return {
    ...empty,
    ...(timelineOk ? {
      capture_started_at: new Date(started).toISOString(),
      capture_ended_at: new Date(ended).toISOString(),
      capture_duration_ms: input.durationMs,
    } : {}),
    ...(hasPosition ? {
      capture_lat: input.lat as number,
      capture_lng: input.lng as number,
      capture_accuracy_m: typeof input.accuracyM === 'number' ? Math.round(input.accuracyM) : null,
      capture_distance_m: distance,
    } : {}),
  }
}

/** Great-circle distance in metres (haversine). Plenty for "is this near the course". */
export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
