/**
 * A golf day as a calendar event, so a player who joined has the day, the
 * holes and the link in their calendar, with a reminder that morning.
 *
 * Two forms of one event: an .ics file (GET /api/golf-days/[slug]/calendar),
 * which an iPhone opens straight into its "Add to Calendar" sheet, and a
 * Google Calendar link, which is how an Android phone adds an event. Google
 * Calendar ignores reminders in a link; the phone's default one applies.
 */
import { formatRand } from '@/lib/format'
import { golfDayPath, golfDayVenue, shortCourseName, type PublicGolfDay } from './rules'

export type CalendarDay = Pick<PublicGolfDay, 'slug' | 'name' | 'tabLabel' | 'playsOn' | 'prizeZAR' | 'holes'>

export interface GolfDayEvent {
  /** The same for everyone and every download, so adding it twice updates rather than repeats. */
  uid: string
  title: string
  /** An all-day event on the golf day's date: start inclusive, end exclusive, as YYYYMMDD. */
  start: string
  end: string
  location: string
  details: string
  url: string
  /** What the reminder says at REMINDER_HOUR on the day. */
  reminder: string
}

/** The reminder goes off at 07:00 on the day, before most golf days tee off. */
export const REMINDER_HOUR = 7

const compact = (date: string) => date.replaceAll('-', '')

function dayAfter(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** "A", "A or B", "A, B or C". */
function either(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/**
 * The event. `site` is the app's origin ("https://www.getluckyholeinone.com");
 * `venue` is the theme's short name for the club, when it has one.
 */
export function golfDayEvent(day: CalendarDay, { site, venue }: { site: string; venue: string | null }): GolfDayEvent {
  const url = `${site.replace(/\/$/, '')}${golfDayPath(day.slug)}`
  const prize = formatRand(day.prizeZAR)
  const names = day.holes.map(h => h.course.name)
  const holes = day.holes.map(h => `${shortCourseName(h.course.name, names)} ${h.holeNumber}${h.distanceMetres ? ` (${h.distanceMetres} m)` : ''}`)
  const where = day.holes.find(h => h.course.location)?.course.location
  const club = venue ?? golfDayVenue(day.holes)

  return {
    uid: `golf-day-${day.slug}@${new URL(site).host}`,
    title: `${day.name}: free swing for ${prize}`,
    start: compact(day.playsOn),
    end: compact(dayAfter(day.playsOn)),
    location: where ? `${club}, ${where}` : club,
    details: [
      `Your free swing for ${prize}. Hole it and it's yours.`,
      ...(holes.length ? [`Play it at ${either(holes)}.`] : []),
      `On the day, open the ${day.tabLabel} tab in Get Lucky, or this link, and tap your hole. A playing partner films your tee shot.\n${url}`,
      '18+ only. One swing each.',
    ].join('\n\n'),
    url,
    reminder: `${day.name} is today. Open the ${day.tabLabel} tab in Get Lucky for your free swing.`,
  }
}

/** RFC 5545 text: backslash, semicolon and comma escaped, line breaks as \n. */
function text(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

const encoder = new TextEncoder()

/** Lines of at most 75 bytes, continued on the next line after a space, never splitting a character. */
function fold(line: string): string {
  const parts: string[] = []
  let part = ''
  let bytes = 0
  for (const char of line) {
    const size = encoder.encode(char).length
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(part)
      part = ''
      bytes = 0
    }
    part += char
    bytes += size
  }
  parts.push(part)
  return parts.join('\r\n ')
}

/** The event as an .ics file. `now` stamps it. */
export function toIcs(event: GolfDayEvent, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Get Lucky//Golf days//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${event.start}`,
    `DTEND;VALUE=DATE:${event.end}`,
    `SUMMARY:${text(event.title)}`,
    `LOCATION:${text(event.location)}`,
    `DESCRIPTION:${text(event.details)}`,
    `URL:${event.url}`,
    // A reminder in the diary, not a meeting: the day stays free.
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${text(event.reminder)}`,
    // From the all-day event's start, midnight on the day.
    `TRIGGER:PT${REMINDER_HOUR}H`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n'
}

/** The event as a Google Calendar link: the Android way to add it. */
export function googleCalendarUrl(event: GolfDayEvent): string {
  const query = Object.entries({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${event.start}/${event.end}`,
    details: event.details,
    location: event.location,
  }).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')
  // %20, not URLSearchParams' +, for spaces: unambiguous to any reader of the link.
  return `https://calendar.google.com/calendar/render?${query}`
}
