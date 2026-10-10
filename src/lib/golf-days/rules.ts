/**
 * Golf days (migration 029): a golf day we sponsor gives every player who
 * joins through its link one free swing, on that day, on its holes, for its
 * prize.
 *
 * A golf trip (migration 033) is a golf day that runs over several days,
 * from playsOn to endsOn: a swing for each player in every round, on that
 * round's hole (each hole carries its round's date), for the trip's prize,
 * which can be in dollars.
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
import type { GolfDayLook } from './look'

/** A golf day's link is /golf-day/<slug>. Mirrors the table's check. */
export const GOLF_DAY_SLUG_PATTERN = /^[a-z0-9-]{2,40}$/

export function golfDayPath(slug: string): string {
  return `/golf-day/${slug}`
}

/**
 * A golf day's join code (migration 038): 4 to 12 capitals and digits, as
 * stored. Mirrors the table's check. A link gets forwarded; a code set on
 * the day is handed out by the organiser, so a forwarded link alone does
 * not get a swing at the prize.
 */
export const GOLF_DAY_JOIN_CODE_PATTERN = /^[A-Z0-9]{4,12}$/

/** As typed → as stored: case and spaces do not matter to a player. */
export function normaliseJoinCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase()
}

/** Whether what a player typed is the golf day's code. Null when the day has none: anything goes. */
export function joinCodeMatches(stored: string | null | undefined, typed: string | null | undefined): boolean {
  if (!stored) return true
  return typeof typed === 'string' && normaliseJoinCode(typed) === normaliseJoinCode(stored)
}

/** A golf day's prize is in rand; a golf trip's can be in dollars (migration 033). */
export type PrizeCurrency = 'ZAR' | 'USD'
export const PRIZE_CURRENCIES: readonly PrizeCurrency[] = ['ZAR', 'USD']

/** The most a prize may be, in whole units: R1 000 000, or $50 000 (about the same). */
export const PRIZE_MAX: Record<PrizeCurrency, number> = { ZAR: 1_000_000, USD: 50_000 }

/** A trip runs at most this many days after it starts (the table's check). */
export const TRIP_MAX_DAYS = 30

/** golf_days.prize_currency, read safely: rand before migration 033, or for anything unknown. */
export function currencyFrom(raw: unknown): PrizeCurrency {
  return raw === 'USD' ? 'USD' : 'ZAR'
}

/** South Africa keeps +02:00 all year, so a date is one fixed 24-hour window. */
const SAST_OFFSET = '+02:00'
const DAY_MS = 24 * 3_600_000

/** The longest the golf day tab stays after the day, for a player whose swing is still in hand. */
export const TAB_DAYS_AFTER = 7

/** Midnight at the start of `playsOn` (YYYY-MM-DD) in South Africa. */
export function opensAt(playsOn: string): number {
  return Date.parse(`${playsOn}T00:00:00${SAST_OFFSET}`)
}

/** Midnight at the end of `playsOn` in South Africa. */
export function closesAt(playsOn: string): number {
  return opensAt(playsOn) + DAY_MS
}

/** 'today' is the day itself, or any day of a trip. */
export type GolfDayPhase = 'upcoming' | 'today' | 'over'

/** The last day a golf day runs: a trip's end date, or the one day. */
export function lastDay(playsOn: string, endsOn: string | null | undefined): string {
  return endsOn ?? playsOn
}

export function golfDayPhase(playsOn: string, now: number = Date.now(), endsOn: string | null = null): GolfDayPhase {
  if (now < opensAt(playsOn)) return 'upcoming'
  if (now < closesAt(lastDay(playsOn, endsOn))) return 'today'
  return 'over'
}

/** The end of the most the golf day tab can stay up: a week after the day. Pass a trip's last day. */
export function tabVisible(lastPlayed: string, now: number = Date.now()): boolean {
  return now < closesAt(lastPlayed) + TAB_DAYS_AFTER * DAY_MS
}

/**
 * A swing still in hand: started and still open to film, claimed, or
 * verified and not yet paid. A missed, paid or lapsed swing is done.
 */
export function swingInHand(status: string, expiresAt: string | null, now: number = Date.now()): boolean {
  if (status === 'claimed' || status === 'verified' || status === 'payout_approved') return true
  return status === 'active' && (!expiresAt || Date.parse(expiresAt) > now)
}

/**
 * Whether a joined player sees the golf day's tab in place of Icons: until
 * the day (a trip's last day) is over; after it, only while one of their
 * swings there is still in hand, and for a week at most. A finished golf
 * day goes, and Icons comes back.
 */
export function tabShows(lastPlayed: string, inHand: boolean, now: number = Date.now()): boolean {
  if (now < closesAt(lastPlayed)) return true
  return inHand && tabVisible(lastPlayed, now)
}

/** A date (YYYY-MM-DD) n days on. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Today's date in South Africa, as YYYY-MM-DD. */
export function todayInSouthAfrica(now: number = Date.now()): string {
  return new Date(now + 2 * 3_600_000).toISOString().slice(0, 10)
}

/** "Friday 2 October", for a golf day's date. (en-GB: en-ZA would give "Friday, 02 October".) */
export function formatGolfDayDate(playsOn: string): string {
  return new Date(`${playsOn}T12:00:00${SAST_OFFSET}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg',
  })
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A trip round's date, short: "Sun 14 Feb". Spelt out by hand: en-GB's
 * short form is "Sun, 14 Feb" in Chrome and "Sun 14 Feb" in Node.
 */
export function formatRoundDate(playsOn: string): string {
  const [y, m, d] = playsOn.split('-').map(Number)
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`
}

/** "Friday 2 October" for a day; "14–20 February" or "28 February – 3 March" for a trip. */
export function formatGolfDayDates(playsOn: string, endsOn: string | null): string {
  if (!endsOn) return formatGolfDayDate(playsOn)
  const part = (date: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${date}T12:00:00${SAST_OFFSET}`).toLocaleDateString('en-GB', { ...opts, timeZone: 'Africa/Johannesburg' })
  const sameMonth = playsOn.slice(0, 7) === endsOn.slice(0, 7)
  return sameMonth
    ? `${part(playsOn, { day: 'numeric' })}–${part(endsOn, { day: 'numeric', month: 'long' })}`
    : `${part(playsOn, { day: 'numeric', month: 'long' })} – ${part(endsOn, { day: 'numeric', month: 'long' })}`
}

/**
 * The reference a golf day swing carries. Deterministic per golf day and
 * player, and on a trip per hole too (one swing a round), so the unique
 * index on payment_intent_id is a second lock.
 */
export function golfDaySwingReference(golfDayId: string, userId: string, tripHoleId?: string): string {
  return tripHoleId ? `golfday_${golfDayId}_${userId}_${tripHoleId}` : `golfday_${golfDayId}_${userId}`
}

/** The holes whose round is on `date`. On a golf day of one day (no dates on its holes), all of them. */
export function holesOn(holes: GolfDayHole[], date: string): GolfDayHole[] {
  return holes.filter(h => !h.playsOn || h.playsOn === date)
}

/** A trip's holes by the date of their round, in date order; holes with no date last. */
export function rounds(holes: GolfDayHole[]): { date: string | null; holes: GolfDayHole[] }[] {
  const byDate = new Map<string | null, GolfDayHole[]>()
  for (const h of holes) byDate.set(h.playsOn, [...(byDate.get(h.playsOn) ?? []), h])
  return [...byDate.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([date, list]) => ({ date, holes: list }))
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
  | 'GOLF_DAY_WRONG_DAY'
  | 'GOLF_DAY_SWING_USED'
  | 'GOLF_DAY_ROUND_USED'
  | 'GOLF_DAY_CODE_REQUIRED'
  | 'GOLF_DAY_CODE_WRONG'

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
  GOLF_DAY_WRONG_DAY:   { status: 409, error: 'That hole’s round is on another day. Your swing there opens on the day.' },
  GOLF_DAY_SWING_USED:  { status: 409, error: 'You have already taken your swing at this golf day.' },
  GOLF_DAY_ROUND_USED:  { status: 409, error: 'You have already taken your swing on this hole. Your next one is in the next round.' },
  GOLF_DAY_CODE_REQUIRED: { status: 403, error: 'This golf day needs its join code. Ask the organiser for it.' },
  GOLF_DAY_CODE_WRONG:  { status: 403, error: 'That join code is not right. Check it and try again.' },
}

/** The refusals the migration 029 and 033 triggers raise, as their message. */
const TRIGGER_REFUSALS = new Set<GolfDayRefusal>([
  'GOLF_DAY_NOT_FOUND', 'GOLF_DAY_CLOSED', 'GOLF_DAY_OVER', 'GOLF_DAY_FULL',
  'GOLF_DAY_NOT_YET', 'GOLF_DAY_NOT_JOINED', 'GOLF_DAY_WRONG_HOLE', 'GOLF_DAY_WRONG_PRIZE',
  'GOLF_DAY_WRONG_DAY',
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
  /** On a trip, the date of this hole's round; null on a golf day of one day. */
  playsOn: string | null
}

export interface PublicGolfDay {
  slug: string
  name: string
  tabLabel: string
  playsOn: string
  /** A trip's last day; null for a golf day of one day. */
  endsOn: string | null
  /** The prize in whole rand, or whole dollars on a trip priced in dollars. */
  prize: number
  currency: PrizeCurrency
  phase: GolfDayPhase
  closed: boolean
  full: boolean
  /** Joining needs the golf day's code (migration 038). The code itself is never sent here. */
  requiresCode: boolean
  holes: GolfDayHole[]
  /** The look set in the admin; null when it has none (the code theme or the Get Lucky look applies). */
  look: GolfDayLook | null
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
  /** Their swings: at most one on a golf day, one a round on a trip. */
  swings: GolfDaySwing[]
}

export interface AdminGolfDay {
  id: string
  slug: string
  name: string
  tabLabel: string
  playsOn: string
  endsOn: string | null
  prize: number
  currency: PrizeCurrency
  maxPlayers: number
  /** The code players must type to join, or null when the link alone is enough. */
  joinCode: string | null
  note: string | null
  disabledAt: string | null
  phase: GolfDayPhase
  players: number
  swings: number
  claimed: number
  holes: GolfDayHole[]
  createdAt: string
  look: GolfDayLook | null
}

/**
 * The club all the holes belong to ("Royal Johannesburg & Kensington"), or
 * the course names; over more than three clubs (a trip), how many courses.
 * A trip's admin names its venue ("Cape Town") in the look.
 */
export function golfDayVenue(holes: GolfDayHole[]): string {
  const names = [...new Set(holes.map(h => h.course.name))]
  const clubs = [...new Set(names.map(n => (n.includes(' – ') ? n.slice(0, n.lastIndexOf(' – ')) : n)))]
  if (clubs.length === 1) return clubs[0]
  return clubs.length > 3 ? `${names.length} courses` : names.join(' · ')
}

/** Every hole is on the one course, so a hole needs no course named beside it ("Hole 16"). */
export function oneCourse(holes: GolfDayHole[]): boolean {
  return new Set(holes.map(h => h.course.id)).size <= 1
}

/** A course as golfers say it: "Pearl Valley" for "Pearl Valley Golf Club", "Clovelly" for "Clovelly Country Club". */
export function plainCourseName(name: string): string {
  return name.replace(/\s+(golf (?:club|course|estate)|country club|golf & country (?:club|estate))$/i, '')
}

/** Course names carry the club: "Royal Johannesburg & Kensington – East" reads "East" next to its sibling. */
export function shortCourseName(name: string, siblings: string[]): string {
  const dash = name.lastIndexOf(' – ')
  if (dash === -1) return name
  const club = name.slice(0, dash)
  return siblings.filter(s => s.startsWith(club + ' – ')).length > 1 ? name.slice(dash + 3) : name
}
