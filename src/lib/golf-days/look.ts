/**
 * A golf day's look, as set in /admin/golf-days and kept on golf_days.look
 * (migration 031): the picture at the top, the host's name and colours,
 * the venue as players know it, the line under the prize and any small
 * print the host's brand needs. Every field is optional; what is missing
 * comes from the code theme for that link, then the Get Lucky look
 * (src/lib/golf-days/themes.ts).
 *
 * Also here, for the admin: WCAG contrast, and colours suggested from an
 * uploaded picture.
 */
import { z } from 'zod'

/** The public storage bucket uploaded golf day pictures live in (migration 031). */
export const ART_BUCKET = 'golf-day-art'

export const HEX_COLOUR = /^#[0-9a-f]{6}$/i

const colour = z.string().trim().regex(HEX_COLOUR, 'A colour is # and six hex digits').transform(s => s.toLowerCase())

/**
 * Where a golf day's picture may come from: the app's own files under
 * /golf-days/, or the art bucket of this Supabase project. Nothing else,
 * so a golf day screen never loads an image from somewhere unknown.
 */
export function isArtSrc(src: string, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''): boolean {
  if (src.includes('..') || /[\s"'<>]/.test(src)) return false
  if (/^\/golf-days\/[\w./-]+$/.test(src)) return true
  const base = supabaseUrl.replace(/\/$/, '')
  return Boolean(base) && src.startsWith(`${base}/storage/v1/object/public/${ART_BUCKET}/`)
}

export const HeroSchema = z.object({
  src: z.string().max(500).refine(src => isArtSrc(src), 'Upload the picture here'),
  alt: z.string().trim().max(200),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
  /** 'photo' fills a frame the label overlaps; 'logo' is shown whole. */
  kind: z.enum(['photo', 'logo']),
})

export const LookSchema = z.object({
  host: z.string().trim().min(1).max(60).optional(),
  /** The venue on the label, when players know the club by a shorter name. */
  venue: z.string().trim().min(1).max(40).nullable().optional(),
  tagline: z.string().trim().min(1).max(120).optional(),
  /** Small print, such as an alcohol brand's 18+ line. */
  footnote: z.string().trim().min(1).max(200).nullable().optional(),
  ink: colour.optional(),
  accent: colour.optional(),
  paper: colour.optional(),
  page: colour.optional(),
  hero: HeroSchema.nullable().optional(),
})

export type GolfDayLook = z.infer<typeof LookSchema>

/** A stored look, or null when there is none or it no longer reads. */
export function parseLook(value: unknown): GolfDayLook | null {
  if (value === null || value === undefined) return null
  const parsed = LookSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** The 18+ line an alcohol brand needs, in the words Bomb Squad's screen uses. */
export function alcoholFootnote(host: string): string {
  return `${host.trim() || 'This brand'}. Not for sale to persons under the age of 18. Enjoy responsibly.`
}

// ── Colour arithmetic ─────────────────────────────────────────────

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
}

function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio of two #rrggbb colours, 1 to 21. Text needs 4.5; the label's type is set at 7. */
export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function hsl([r, g, b]: Rgb): { h: number; s: number; l: number } {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rr ? ((gg - bb) / d + (gg < bb ? 6 : 0)) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4
  return { h: h * 60, s, l }
}

export interface Palette { ink: string; accent: string; paper: string; page: string }

/**
 * Colours for a golf day, suggested from its picture: RGBA pixels, any
 * size (a thumbnail is plenty). Transparent pixels are left out.
 *
 *   ink     the picture's commonest dark colour, darkened until type in it
 *           reads on the paper at 7:1
 *   paper   its commonest light colour, or white
 *   page    the paper, a shade towards the ink
 *   accent  its commonest strong colour that is not the ink's own hue
 *
 * A suggestion: the admin shows it and it can be changed.
 */
export function suggestPalette(rgba: ArrayLike<number>): Palette {
  type Group = { n: number; r: number; g: number; b: number; s: number }
  const add = (map: Map<number, Group>, key: number, [r, g, b]: Rgb, s: number) => {
    const group = map.get(key) ?? { n: 0, r: 0, g: 0, b: 0, s: 0 }
    group.n++; group.r += r; group.g += g; group.b += b; group.s += s
    map.set(key, group)
  }
  const dark = new Map<number, Group>()
  const light = new Map<number, Group>()
  const strong = new Map<number, Group>()
  let opaque = 0

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 200) continue
    opaque++
    const px: Rgb = [rgba[i], rgba[i + 1], rgba[i + 2]]
    const lum = luminance(px)
    const { h, s, l } = hsl(px)
    const hue = Math.floor(h / 30) % 12
    if (lum < 0.06) add(dark, hue * 4 + Math.min(3, Math.floor(s * 4)), px, s)
    else if (lum > 0.7 && s < 0.6) add(light, 0, px, s)
    if (s > 0.5 && l > 0.25 && l < 0.7) add(strong, hue, px, s)
  }

  /** The group with the most pixels (or the most by `weigh`), averaged. */
  const commonest = (map: Map<number, Group>, minShare: number, skip?: (key: number) => boolean, weigh = (g: Group) => g.n): Rgb | null => {
    let best: [number, Group] | null = null
    for (const entry of map) {
      if (skip?.(entry[0])) continue
      if (!best || weigh(entry[1]) > weigh(best[1])) best = entry
    }
    if (!best || best[1].n < opaque * minShare) return null
    const g = best[1]
    return [g.r / g.n, g.g / g.n, g.b / g.n]
  }

  const paperRgb = commonest(light, 0.02) ?? [255, 255, 255]
  const paper = mix(paperRgb, [255, 255, 255], 0.35)
  let ink = commonest(dark, 0.01) ?? [31, 41, 36]
  for (let i = 0; i < 12 && contrast(rgbToHex(ink), rgbToHex(paper)) < 7; i++) ink = mix(ink, [0, 0, 0], 0.25)

  const inkHue = Math.floor(hsl(ink).h / 30) % 12
  const inkIsGrey = hsl(ink).s < 0.15
  // Vivid beats plentiful: a logo's hot pink over the skin tones around it.
  const vivid = (g: Group) => g.n * (g.s / g.n) ** 4
  const accent = commonest(strong, 0.005, hue => !inkIsGrey && hue === inkHue, vivid)
    ?? commonest(strong, 0.005, undefined, vivid)
    ?? mix(ink, [255, 255, 255], 0.45)

  return {
    ink: rgbToHex(ink),
    accent: rgbToHex(accent),
    paper: rgbToHex(paper),
    page: rgbToHex(mix(paper, ink, 0.06)),
  }
}
