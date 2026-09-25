/**
 * The WhatsApp message that goes out with a golf day's link, as the admin
 * offers it to copy. Asterisks are WhatsApp's bold. Short and a bit cheeky,
 * in Johannes's voice, and every step in it is a real one: sign in, Join,
 * home screen and calendar; on the day, the tab and the hole.
 */
import { formatRand } from '@/lib/format'
import { formatGolfDayDate, golfDayPath, golfDayVenue, oneCourse, shortCourseName, type GolfDayHole } from './rules'

export interface MessageDay {
  slug: string
  name: string
  tabLabel: string
  playsOn: string
  prizeZAR: number
  holes: GolfDayHole[]
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/** "A", "A or B", "A, B or C". */
function either(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/**
 * Where to play: "at *East 16* or *West 17*" over two courses, or
 * "at Umdoni Park's *16th*" on one, with the venue as the label names it.
 */
function where(day: MessageDay, venue: string | null): string {
  if (!day.holes.length) return 'at the golf day hole'
  if (oneCourse(day.holes)) {
    const club = venue ?? golfDayVenue(day.holes)
    return `at ${club}'s ${either(day.holes.map(h => `*${ordinal(h.holeNumber)}*`))}`
  }
  const names = day.holes.map(h => h.course.name)
  return `at ${either(day.holes.map(h => `*${shortCourseName(h.course.name, names)} ${h.holeNumber}*`))}`
}

/** The message, ready to paste into WhatsApp. `site` is the app's origin. */
export function golfDayMessage(day: MessageDay, { site, venue }: { site: string; venue: string | null }): string {
  const date = formatGolfDayDate(day.playsOn) // "Friday 2 October"
  const weekday = date.split(' ')[0]
  const link = `${site.replace(/\/$/, '')}${golfDayPath(day.slug)}`
  const theHole = day.holes.length === 1 ? 'the' : 'your'

  return [
    `⛳ *${day.name} × Get Lucky* 🍀`,
    '',
    `One free swing. One hole. *${formatRand(day.prizeZAR)}* if it drops on *${date}*. 💰`,
    '',
    `📲 *Before ${weekday}:* tap the link, sign in, hit *Join*, then add it to your home screen and calendar.`,
    link,
    '',
    `🏌️ *On the day:* ${where(day, venue)}, open the *${day.tabLabel}* tab, tap ${theHole} hole and get a mate to film it.`,
    '',
    "18+. One swing each. Swing like the rent's due. 🍀",
  ].join('\n')
}
