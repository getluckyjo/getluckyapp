/**
 * How a golf day's screen looks. The facts (date, holes, prize, places)
 * live in the golf_days table and are edited in the admin; the look lives
 * here, with its photo in public/golf-days/<slug>/, because a host's
 * branding is artwork, not data. A golf day with no entry here gets the
 * Get Lucky look.
 */

export interface GolfDayTheme {
  /** Photo across the top of the screen, from /public. Null: a plain band. */
  heroImage: string | null
  heroAlt: string
  /** Who is hosting, as players know them. */
  host: string
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
  heroImage: null,
  heroAlt: '',
  host: 'Get Lucky',
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
    heroImage: '/golf-days/bombsquad/hero.jpg',
    heroAlt: 'Two cans of Bomb Squad Lager raised in a toast',
    host: 'Bomb Squad Lager',
    tagline: 'Quench your thirst. Hole it on the day and it’s yours.',
    ink: '#1f3a2f',
    accent: '#b8914a',
    paper: '#ffffff',
    page: '#f3f2ed',
    footnote: 'Bomb Squad Lager. Not for sale to persons under the age of 18. Enjoy responsibly.',
  },
}

export function themeFor(slug: string): GolfDayTheme {
  return THEMES[slug] ?? DEFAULT_THEME
}
