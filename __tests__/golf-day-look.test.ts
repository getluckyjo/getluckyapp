/**
 * A golf day's look (src/lib/golf-days/look.ts, themes.ts) and the WhatsApp
 * message that goes out with its link (message.ts).
 *
 * Pinned here: a saved look only takes pictures from the app or its own art
 * bucket and colours as #rrggbb; it lays over the code theme, which lays
 * over the Get Lucky look; colours suggested from a picture read at 7:1 and
 * find its vivid colour; the message names the real steps, the tab and the
 * holes, short.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { LookSchema, alcoholFootnote, contrast, isArtSrc, parseLook, suggestPalette } from '@/lib/golf-days/look'
import { DEFAULT_THEME, themeFor } from '@/lib/golf-days/themes'
import { golfDayMessage, ordinal } from '@/lib/golf-days/message'
import type { GolfDayHole } from '@/lib/golf-days/rules'

const SUPABASE = 'https://abc.supabase.co'
afterEach(() => vi.unstubAllEnvs())

describe('a saved look', () => {
  it('takes pictures only from the app or its own art bucket', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE)
    expect(isArtSrc('/golf-days/bombsquad/hero.jpg')).toBe(true)
    expect(isArtSrc(`${SUPABASE}/storage/v1/object/public/golf-day-art/1b2c.webp`)).toBe(true)
    for (const src of [
      'https://evil.example/pic.webp',
      `${SUPABASE}/storage/v1/object/public/shot-videos/x.webp`,
      `${SUPABASE}/storage/v1/object/public/golf-day-art/../shot-videos/x`,
      '/golf-days/../api/x',
      'javascript:alert(1)',
      '/golf-days/a b.jpg',
    ]) expect(isArtSrc(src), src).toBe(false)
  })

  it('reads the looks migration 031 copies onto Bomb Squad and SaSwazi', () => {
    const bombsquad = parseLook({
      hero: { src: '/golf-days/bombsquad/hero.jpg', alt: 'Two cans', width: 1000, height: 1244, kind: 'photo' },
      host: 'Bomb Squad Lager', venue: 'Royal Johannesburg', tagline: 'Quench your thirst.',
      ink: '#1f3a2f', accent: '#b8914a', paper: '#ffffff', page: '#f3f2ed', footnote: 'Bomb Squad Lager. Not for sale…',
    })
    expect(bombsquad?.hero?.kind).toBe('photo')
    expect(parseLook({ host: 'SaSwazi', venue: 'Umdoni Park', footnote: null, ink: '#0F3322' })).toMatchObject({ ink: '#0f3322', footnote: null })
  })

  it('refuses bad colours and pictures from elsewhere; a stored look that no longer reads is ignored', () => {
    expect(LookSchema.safeParse({ ink: 'green' }).success).toBe(false)
    expect(LookSchema.safeParse({ ink: '#12345' }).success).toBe(false)
    expect(LookSchema.safeParse({ hero: { src: 'https://evil.example/x.png', alt: '', width: 10, height: 10, kind: 'logo' } }).success).toBe(false)
    expect(LookSchema.safeParse({ hero: { src: '/golf-days/x.webp', alt: '', width: 10, height: 10, kind: 'banner' } }).success).toBe(false)
    expect(parseLook({ ink: 'not a colour' })).toBeNull()
    expect(parseLook(null)).toBeNull()
  })

  it('lays over the code theme, which lays over the Get Lucky look', () => {
    expect(themeFor('no-such-day')).toEqual(DEFAULT_THEME)
    expect(themeFor('no-such-day', { host: 'Acme', ink: '#111111' })).toMatchObject({ host: 'Acme', ink: '#111111', paper: DEFAULT_THEME.paper, hero: null })
    const bombsquad = themeFor('bombsquad')
    expect(bombsquad.hero?.src).toBe('/golf-days/bombsquad/hero.jpg')
    // What the saved look sets wins; what it leaves out stays the code theme's.
    const edited = themeFor('bombsquad', { tagline: 'New line', venue: null, footnote: null, hero: null })
    expect(edited).toMatchObject({ tagline: 'New line', venue: null, footnote: null, hero: null, host: 'Bomb Squad Lager', ink: bombsquad.ink })
  })

  it('writes the 18+ line for an alcohol brand', () => {
    expect(alcoholFootnote('Bomb Squad Lager')).toBe('Bomb Squad Lager. Not for sale to persons under the age of 18. Enjoy responsibly.')
  })
})

describe('colours from a picture', () => {
  /** RGBA pixels: `n` of each colour. */
  const pixels = (...groups: [number, [number, number, number, number?]][]) =>
    Uint8Array.from(groups.flatMap(([n, [r, g, b, a = 255]]) => Array.from({ length: n }, () => [r, g, b, a]).flat()))

  it("finds a sticker's dark ink, cream card and vivid pink, over its skin tones, and ignores see-through pixels", () => {
    const p = suggestPalette(pixels(
      [400, [251, 239, 208]], // cream
      [300, [8, 39, 23]], // bottle green
      [200, [220, 150, 110]], // skin
      [60, [240, 19, 109]], // hot pink
      [900, [255, 0, 0, 0]], // transparent red: not there
    ))
    expect(p.accent).toMatch(/^#[d-f][0-9a-f]/) // a strong red-pink, not the skin tone
    const [r, g, b] = [1, 3, 5].map(i => parseInt(p.accent.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(180); expect(g).toBeLessThan(90); expect(b).toBeGreaterThan(70)
    expect(contrast(p.ink, p.paper)).toBeGreaterThanOrEqual(7)
    expect(p.ink).not.toBe(p.paper)
  })

  it('a washed-out photo still gets readable ink on white', () => {
    const p = suggestPalette(pixels([500, [170, 170, 170]], [500, [120, 125, 130]]))
    expect(p.paper).toBe('#ffffff')
    expect(contrast(p.ink, p.paper)).toBeGreaterThanOrEqual(7)
  })

  it('contrast is WCAG: black on white is 21, a colour on itself is 1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#345231', '#345231')).toBeCloseTo(1, 5)
  })
})

describe('the WhatsApp message', () => {
  const hole = (course: string, holeNumber: number): GolfDayHole =>
    ({ holeId: `${course}${holeNumber}`, holeNumber, par: 3, distanceMetres: 150, course: { id: course, name: course, location: '', region: '' } })
  const SITE = 'https://www.getluckyholeinone.com'

  it('Bomb Squad: two courses, the BS tab, short', () => {
    const text = golfDayMessage({
      slug: 'bombsquad', name: 'Bomb Squad Golf Day', tabLabel: 'BS', playsOn: '2026-10-02', prizeZAR: 100000,
      holes: [hole('Royal Johannesburg & Kensington – East', 16), hole('Royal Johannesburg & Kensington – West', 17)],
    }, { site: SITE, venue: 'Royal Johannesburg' })
    expect(text).toBe([
      '⛳ *Bomb Squad Golf Day × Get Lucky* 🍀',
      '',
      'One free swing. One hole. *R100 000* if it drops on *Friday 2 October*. 💰',
      '',
      '📲 *Before Friday:* tap the link, sign in, hit *Join*, then add it to your home screen and calendar.',
      'https://www.getluckyholeinone.com/golf-day/bombsquad',
      '',
      '🏌️ *On the day:* at *East 16* or *West 17*, open the *BS* tab, tap your hole and get a mate to film it.',
      '',
      "18+. One swing each. Swing like the rent's due. 🍀",
    ].join('\n'))
  })

  it('SaSwazi: one hole on one course, named by the venue', () => {
    const text = golfDayMessage({
      slug: 'saswazi', name: 'SaSwazi Golf Trek', tabLabel: 'SaSwazi', playsOn: '2026-10-02', prizeZAR: 100000,
      holes: [hole('Umdoni Park Golf Club', 16)],
    }, { site: `${SITE}/`, venue: 'Umdoni Park' })
    expect(text).toContain("at Umdoni Park's *16th*, open the *SaSwazi* tab, tap the hole and get a mate to film it.")
    expect(text).toContain('https://www.getluckyholeinone.com/golf-day/saswazi\n')
    expect(text.split('\n').length).toBeLessThanOrEqual(10)
  })

  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 16, 21, 22, 23].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '16th', '21st', '22nd', '23rd'])
  })
})
