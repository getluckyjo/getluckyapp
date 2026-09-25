/**
 * src/lib/golf-days/calendar.ts — a golf day in the player's calendar.
 *
 * Pinned here: the event is all day on the golf day itself, carries the
 * link and the holes, reminds at 07:00, and is a well-formed .ics (escaped,
 * folded, CRLF) that Apple and Google Calendar accept.
 */
import { describe, it, expect } from 'vitest'
import { golfDayEvent, googleCalendarUrl, toIcs, venueOf } from '@/lib/golf-days/calendar'
import type { GolfDayHole } from '@/lib/golf-days/rules'

const holes: GolfDayHole[] = [
  { holeId: 'h1', holeNumber: 16, par: 3, distanceMetres: 152, course: { id: 'c1', name: 'Royal Johannesburg & Kensington – East', location: '', region: 'Gauteng' } },
  { holeId: 'h2', holeNumber: 17, par: 3, distanceMetres: 161, course: { id: 'c2', name: 'Royal Johannesburg & Kensington – West', location: '', region: 'Gauteng' } },
]
const day = { slug: 'bombsquad', name: 'Bomb Squad Golf Day', tabLabel: 'BS', playsOn: '2026-10-02', prizeZAR: 100000, holes }
const event = golfDayEvent(day, 'Royal Johannesburg', 'https://www.getluckyholeinone.com/')

describe('the golf day event', () => {
  it('names the day, the prize, the holes, the tab and the link', () => {
    expect(event.title).toMatch(/^Bomb Squad Golf Day: free swing for R\s?100\s?000$/)
    expect(event.url).toBe('https://www.getluckyholeinone.com/golf-day/bombsquad')
    expect(event.description).toContain('East 16 (152 m) or West 17 (161 m)')
    expect(event.description).toContain('the BS tab')
    expect(event.description).toContain('Your link: https://www.getluckyholeinone.com/golf-day/bombsquad')
    expect(event.location).toBe('Royal Johannesburg')
  })

  it('the venue defaults to the club the holes share', () => {
    expect(venueOf(holes)).toBe('Royal Johannesburg & Kensington')
  })
})

describe('the .ics file', () => {
  const ics = toIcs(event, new Date('2026-09-25T10:00:00Z'))
  const unfolded = ics.replace(/\r\n /g, '')

  it('is one all-day event on the day, ending the day after', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(unfolded).toContain('DTSTART;VALUE=DATE:20261002\r\n')
    expect(unfolded).toContain('DTEND;VALUE=DATE:20261003\r\n')
    expect(unfolded).toContain('UID:golf-day-bombsquad@getluckyholeinone.com\r\n')
    expect(unfolded).toContain('DTSTAMP:20260925T100000Z\r\n')
  })

  it('reminds at 07:00 on the day', () => {
    expect(unfolded).toContain('BEGIN:VALARM\r\nACTION:DISPLAY')
    expect(unfolded).toContain('TRIGGER;RELATED=START:PT7H\r\n')
  })

  it('escapes text and folds every line to 75 bytes', () => {
    expect(unfolded).toContain('LOCATION:Royal Johannesburg\r\n')
    expect(unfolded).toMatch(/DESCRIPTION:Your free swing for R.*\\n\\nAt East 16 \(152 m\) or West 17 \(161 m\)\\, open/)
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
  })

  it('a month end rolls over', () => {
    const end = toIcs(golfDayEvent({ ...day, playsOn: '2026-12-31' }, 'X', 'https://x.test'))
    expect(end).toContain('DTEND;VALUE=DATE:20270101')
  })
})

describe('Google Calendar', () => {
  it('opens the add page for the whole day, with the link in the details', () => {
    const url = new URL(googleCalendarUrl(event))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('dates')).toBe('20261002/20261003')
    expect(url.searchParams.get('details')).toContain('https://www.getluckyholeinone.com/golf-day/bombsquad')
    expect(url.searchParams.get('location')).toBe('Royal Johannesburg')
  })
})
