/**
 * How a golf day's screen looks. The facts (date, holes, prize, places)
 * live in the golf_days table and are edited in the admin; the look lives
 * here, with its artwork in public/golf-days/<slug>/, because a host's
 * branding is artwork, not data. A golf day with no entry here gets the
 * Get Lucky look.
 */

/** The picture at the top of a golf day's screen, from /public. */
export interface GolfDayHero {
  src: string
  alt: string
  /** The file's own size, for its proportions. */
  width: number
  height: number
  /**
   * 'photo' fills a rounded frame and the label overlaps its foot.
   * 'logo' is shown whole, on the page, transparent background and all,
   * with the label below it (a sticker-style logo would lose its edges
   * and its banner to a crop).
   */
  kind: 'photo' | 'logo'
}

export interface GolfDayTheme {
  /** Null: no picture, the label on its own. */
  hero: GolfDayHero | null
  /** Who is hosting, as players know them. */
  host: string
  /**
   * The venue on the label and the swing sheet, when players know the club
   * by a shorter name than the courses table's. Null: the club's name as it
   * is there.
   */
  venue: string | null
  /** One line under the prize. */
  tagline: string
  /** Colours for the label card, taken from the host's own artwork. */
  ink: string
  accent: string
  paper: string
  page: string
  /** Small print the host's brand needs (an alcohol brand's 18+ line, say). */
  footnote: string | null
}

export const DEFAULT_THEME: GolfDayTheme = {
  hero: null,
  host: 'Get Lucky',
  venue: null,
  tagline: 'One swing each. Hole it and it’s yours.',
  ink: '#345231',
  accent: '#d7f34a',
  paper: '#ffffff',
  page: '#ebedea',
  footnote: null,
}

const THEMES: Record<string, GolfDayTheme> = {
  // From the can: white stock, deep bottle-green line work, a gold medallion.
  bombsquad: {
    hero: { src: '/golf-days/bombsquad/hero.jpg', alt: 'Two cans of Bomb Squad Lager raised in a toast', width: 1000, height: 1244, kind: 'photo' },
    host: 'Bomb Squad Lager',
    venue: 'Royal Johannesburg',
    tagline: 'Quench your thirst. Hole it on the day and it’s yours.',
    ink: '#1f3a2f',
    accent: '#b8914a',
    paper: '#ffffff',
    page: '#f3f2ed',
    footnote: 'Bomb Squad Lager. Not for sale to persons under the age of 18. Enjoy responsibly.',
  },
  // From the trek's sticker: cream stock, bottle-green lettering, a hot-pink rim.
  saswazi: {
    hero: { src: '/golf-days/saswazi/logo.webp', alt: 'The SaSwazi Golf Trek logo: the crew on a coastal fairway', width: 900, height: 900, kind: 'logo' },
    host: 'SaSwazi',
    venue: 'Umdoni Park',
    // The logo's banner already says it's going to be wild; this says where.
    tagline: 'One swing each on the 16th. Hole it and it’s yours.',
    ink: '#0f3322',
    accent: '#f0136d',
    paper: '#fffaf0',
    page: '#f6eed8',
    footnote: null,
  },
}

export function themeFor(slug: string): GolfDayTheme {
  return THEMES[slug] ?? DEFAULT_THEME
}
