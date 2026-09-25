/**
 * Golf days (migration 029): a golf day we sponsor gives every player who
 * joins through its link one free swing, on that day, on its holes, for its
 * prize.
 *
 * The database holds every rule: a trigger caps who can join and closes
 * joining once the day is over, a unique index allows one swing per player,
 * and a second trigger allows the swing only to a joined player, only on the
 * day, only on the day's holes and only for the day's prize. What is here is
 * the same rules said once in TypeScript, for the friendly answer before the
 * insert and for the screens, and how a refusal from those triggers reads
 * when it comes back through PostgREST.
 *
 * Nothing here imports server code, so the screens share it.
 */

/** A golf day's link is /golf-day/<slug>. Mirrors the table's check. */
export const GOLF_DAY_SLUG_PATTERN = /^[a-z0-9-]{2,40}$/

export function golfDayPath(slug: string): string {
  return `/golf-day/${slug}`
}

/** South Africa keeps +02:00 all year, so a date is one fixed 24-hour window. */
const SAST_OFFSET = '+02:00'
const DAY_MS = 24 * 3_600_000

/** The golf day tab stays up this long after the day, while claims are in hand. */
export const TAB_DAYS_AFTER = 7

/** Midnight at the start of `playsOn` (YYYY-MM-DD) in South Africa. */
export function opensAt(playsOn: string): number {
  return Date.parse(`${playsOn}T00:00:00${SAST_OFFSET}`)
}

/** Midnight at the end of `playsOn` in South Africa. */
export function closesAt(playsOn: string): number {
  return opensAt(playsOn) + DAY_MS
}

export type GolfDayPhase = 'upcoming' | 'today' | 'over'

export function golfDayPhase(playsOn: string, now: number = Date.now()): GolfDayPhase {
  if (now < opensAt(playsOn)) return 'upcoming'
  if (now < closesAt(playsOn)) return 'today'
  return 'over'
}

/** Whether a joined player still sees the golf day tab in place of Icons. */
export function tabVisible(playsOn: string, now: number = Date.now()): boolean {
  return now < closesAt(playsOn) + TAB_DAYS_AFTER * DAY_MS
}

/** Today's date in South Africa, as YYYY-MM-DD. */
export function todayInSouthAfrica(now: number = Date.now()): string {
  return new Date(now + 2 * 3_600_000).toISOString().slice(0, 10)
}

/** "Friday 2 October", for a golf day's date. (en-ZA would give "Friday, 02 October".) */
export function formatGolfDayDate(playsOn: string): string {
  return new Date(`${playsOn}T12:00:00${SAST_OFFSET}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg',
  })
}

/** The reference a golf day swing carries. Deterministic per golf day and
 *  player, so the unique index on payment_intent_id is a second lock. */
export function golfDaySwingReference(golfDayId: string, userId: string): string {
  return `golfday_${golfDayId}_${userId}`
}

/** Every reason a player can be turned away. */
export type GolfDayRefusal =
  | 'GOLF_DAY_NOT_FOUND'
  | 'GOLF_DAY_CLOSED'
  | 'GOLF_DAY_OVER'
  | 'GOLF_DAY_FULL'
  | 'GOLF_DAY_NOT_YET'
  | 'GOLF_DAY_NOT_JOINED'
  | 'GOLF_DAY_WRONG_HOLE'
  | 'GOLF_DAY_WRONG_PRIZE'
  | 'GOLF_DAY_SWING_USED'

/** What the player is told for each, and with which status. */
export const GOLF_DAY_REFUSALS: Record<GolfDayRefusal, { status: number; error: string }> = {
  GOLF_DAY_NOT_FOUND:   { status: 404, error: 'That golf day link is not valid.' },
  GOLF_DAY_CLOSED:      { status: 409, error: 'This golf day is closed.' },
  GOLF_DAY_OVER:        { status: 409, error: 'This golf day is over.' },
  GOLF_DAY_FULL:        { status: 409, error: 'Every place on this golf day has been taken.' },
  GOLF_DAY_NOT_YET:     { status: 409, error: 'Your swing opens on the day of the golf day.' },
  GOLF_DAY_NOT_JOINED:  { status: 403, error: 'Join the golf day first, then take your swing.' },
  GOLF_DAY_WRONG_HOLE:  { status: 400, error: 'Your swing can only be played on the golf day’s holes.' },
  GOLF_DAY_WRONG_PRIZE: { status: 400, error: 'Your swing could not be started. Please try again.' },
  GOLF_DAY_SWING_USED:  { status: 409, error: 'You have already taken your swing at this golf day.' },
}

/** The refusals the migration 029 triggers raise, as their message. */
const TRIGGER_REFUSALS = new Set<GolfDayRefusal>([
  'GOLF_DAY_NOT_FOUND', 'GOLF_DAY_CLOSED', 'GOLF_DAY_OVER', 'GOLF_DAY_FULL',
  'GOLF_DAY_NOT_YET', 'GOLF_DAY_NOT_JOINED', 'GOLF_DAY_WRONG_HOLE', 'GOLF_DAY_WRONG_PRIZE',
])

/** A trigger's refusal, when that is what an insert error is. */
export function refusalFromDbError(err: { code?: string; message?: string } | null | undefined): GolfDayRefusal | null {
  if (err?.code !== 'P0001' || !err.message) return null
  return TRIGGER_REFUSALS.has(err.message as GolfDayRefusal) ? (err.message as GolfDayRefusal) : null
}

// ── Shapes the routes answer with ───────────────────────────────────────

export interface GolfDayHole {
  holeId: string
  holeNumber: number
  par: number
  distanceMetres: number | null
  course: { id: string; name: string; location: string; region: string }
}

export interface PublicGolfDay {
  slug: string
  name: string
  tabLabel: string
  playsOn: string
  prizeZAR: number
  phase: GolfDayPhase
  closed: boolean
  full: boolean
  holes: GolfDayHole[]
}

export interface GolfDaySwing {
  betId: string
  status: string
  holeId: string
  /** Still inside its play window, so a started swing can still be filmed. */
  open: boolean
}

export interface GolfDayMe {
  joined: boolean
  ageVerified: boolean
  swing: GolfDaySwing | null
}

export interface AdminGolfDay {
  id: string
  slug: string
  name: string
  tabLabel: string
  playsOn: string
  prizeZAR: number
  maxPlayers: number
  note: string | null
  disabledAt: string | null
  phase: GolfDayPhase
  players: number
  swings: number
  claimed: number
  holes: GolfDayHole[]
  createdAt: string
}

/** Course names carry the club: "Royal Johannesburg & Kensington – East" reads "East" next to its sibling. */
export function shortCourseName(name: string, siblings: string[]): string {
  const dash = name.lastIndexOf(' – ')
  if (dash === -1) return name
  const club = name.slice(0, dash)
  return siblings.filter(s => s.startsWith(club + ' – ')).length > 1 ? name.slice(dash + 3) : name
}
