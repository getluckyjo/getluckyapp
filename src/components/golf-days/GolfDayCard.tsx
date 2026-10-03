/**
 * The top of a golf day's screen, its picture and its label, shared by the
 * player's screen (src/app/(play)/golf-day/[slug]) and the admin's preview
 * of a look, so the preview is the real thing. Styles: .gd-* in
 * globals.css, coloured by themeVars on an ancestor.
 */
import type { CSSProperties } from 'react'
import Image from 'next/image'
import { formatPrize } from '@/lib/format'
import { formatGolfDayDates, golfDayVenue, type GolfDayHole, type PrizeCurrency } from '@/lib/golf-days/rules'
import type { GolfDayHero, GolfDayTheme } from '@/lib/golf-days/themes'

/** The theme's colours as the CSS variables the .gd-* styles read. */
export function themeVars(theme: GolfDayTheme): CSSProperties {
  return { '--gd-ink': theme.ink, '--gd-accent': theme.accent, '--gd-paper': theme.paper, '--gd-page': theme.page } as CSSProperties
}

/** "Bomb Squad Golf Day" sets as the host, then GOLF DAY on a line of its own; a Golf Trek, Tour or Trip too. */
export function nameLines(name: string): [string, string | null] {
  const m = /^(.*\S)\s+(golf (?:day|trek|tour|trip))$/i.exec(name.trim())
  return m ? [m[1], m[2]] : [name, null]
}

/**
 * The picture at the top. The app's own files go through the image
 * optimiser; an upload is already a sized WebP in the art bucket, served
 * as it is.
 */
export function GolfDayHeroArt({ hero }: { hero: GolfDayHero }) {
  return (
    <div className={`gd-hero gd-hero--${hero.kind}`}>
      <Image
        src={hero.src}
        alt={hero.alt}
        width={hero.width}
        height={hero.height}
        sizes="480px"
        priority
        unoptimized={!hero.src.startsWith('/')}
      />
    </div>
  )
}

/**
 * The label card: host × Get Lucky, the name, the prize, FREE SWING, where
 * and when, the tagline. A trip's dates are its first to its last, and say
 * the swing is every round.
 */
export function GolfDayLabel({ theme, name, prize, currency, playsOn, endsOn, holes }: {
  theme: GolfDayTheme
  name: string
  prize: number
  currency: PrizeCurrency
  playsOn: string
  endsOn: string | null
  holes: GolfDayHole[]
}) {
  const [top, bottom] = nameLines(name)
  return (
    <section className="gd-label">
      <p className="gd-kicker">{theme.host} <span aria-hidden>×</span> Get Lucky</p>
      <h1 className="gd-name">{top}{bottom && <><br />{bottom}</>}</h1>
      <p className="gd-prize">{formatPrize(prize, currency)}</p>
      <p className="gd-band"><span>Free swing</span></p>
      <p className="gd-meta">{theme.venue ?? golfDayVenue(holes)}<br />{formatGolfDayDates(playsOn, endsOn)}{endsOn && <><br />Every round</>}</p>
      <p className="gd-tagline">{theme.tagline}</p>
    </section>
  )
}
