/**
 * A golf day as a calendar event, so a player who has joined keeps the day
 * and its link: an all-day event on the day, with the link in it and a
 * reminder at 07:00. Pure, so the calendar route (.ics for iPhone and
 * computers) and the golf day screen (a Google Calendar link for Android)
 * build the same event.
 */
import { formatRand } from '@/lib/format'
import { golfDayPath, shortCourseName, type GolfDayHole } from './rules'

export interface GolfDayEvent {
  slug: string
  title: string
  /** YYYY-MM-DD, the day itself. */
  date: string
  location: string
  description: string
  url: string
}

export function golfDayEvent(day: {
  slug: string
  name: string
  tabLabel: string
  playsOn: string
  prizeZAR: number
  holes: GolfDayHole[]
}, venue: string, siteUrl: string): GolfDayEvent {
  const url = `${siteUrl.replace(/\/$/, '')}${golfDayPath(day.slug)}`
  const names = day.holes.map(h => h.course.name)
  const holes = day.holes
    .map(h => `${shortCourseName(h.course.name, names)} ${h.holeNumber}${h.distanceMetres ? ` (${h.distanceMetres} m)` : ''}`)
    .join(' or ')
  const prize = formatRand(day.prizeZAR)
  return {
    slug: day.slug,
    title: `${day.name}: free swing for ${prize}`,
    date: day.playsOn,
    location: venue,
    description: [
      `Your free swing for ${prize}. Hole it and it's yours.`,
      holes ? `At ${holes}, open Get Lucky, tap the ${day.tabLabel} tab and tap your hole. A playing partner films your tee shot.` : '',
      `Your link: ${url}`,
    ].filter(Boolean).join('\n\n'),
    url,
  }
}

/** The club all the holes belong to ("Royal Johannesburg & Kensington"), or the course names. */
export function venueOf(holes: GolfDayHole[]): string {
  const names = [...new Set(holes.map(h => h.course.name))]
  const clubs = [...new Set(names.map(n => (n.includes(' – ') ? n.slice(0, n.lastIndexOf(' – ')) : n)))]
  return clubs.length === 1 ? clubs[0] : names.join(' · ')
}

const compact = (date: string) => date.replaceAll('-', '')

function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** RFC 5545 text: backslash, semicolon, comma and newlines escaped. */
function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Lines longer than 75 bytes are folded: CRLF then a space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += n
  }
  out.push(current)
  return out.join('\r\n ')
}

/** The .ics file: one all-day event, with a reminder at 07:00 on the day. */
export function toIcs(event: GolfDayEvent, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Get Lucky//Golf days//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:golf-day-${event.slug}@getluckyholeinone.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(event.date)}`,
    `DTEND;VALUE=DATE:${compact(dayAfter(event.date))}`,
    `SUMMARY:${escapeText(event.title)}`,
    `LOCATION:${escapeText(event.location)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    `URL:${event.url}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(event.title)}`,
    'TRIGGER;RELATED=START:PT7H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** Google Calendar's "add event" page, which Android opens in the Calendar app. */
export function googleCalendarUrl(event: GolfDayEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${compact(event.date)}/${compact(dayAfter(event.date))}`,
    details: event.description,
    location: event.location,
  })
  return `https://calendar.google.com/calendar/render?${params}`
}
