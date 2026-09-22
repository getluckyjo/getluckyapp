#!/usr/bin/env node
/**
 * Turn the Icons Series player portraits into avatar headshots.
 *
 *   node scripts/crop-icon-heads.mjs <dir-of-source-pngs>
 *
 * The sources are full-length cut-outs with an alpha channel (~983x1297).
 * Dropped into a 44px circle whole, a face is an unrecognisable smudge, so
 * this finds the figure from its alpha, takes the head — the horizontal
 * centre of mass of the top slice, so the crop follows the face rather than
 * the crossed arms below it — and sets it on the team colour.
 *
 * Writes public/marketing/icons/headshots/<slug>.webp at 160px, which covers
 * a 44px avatar at 3x. Names map to slugs in ICON_PHOTOS (src/lib/icons.ts);
 * add a row here and there when the field grows.
 *
 * Re-run it whenever a portrait is added or replaced, then eyeball the
 * results: the head heuristic misreads a tight crop or a cap (see OVERRIDE).
 */
import sharp from 'sharp'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

// filename fragment → [slug, Icon name, team]
const MAP = [
  ['ELS 2',          'els',         'Ernie Els',           'rsa'],
  ['JMO_Cuout2',     'olazabal',    'José María Olazábal', 'world'],
  ['DE VILLIERS',    'de-villiers', 'AB de Villiers',      'rsa'],
  ['TERRY',          'terry',       'John Terry',          'world'],
  ['BUTCH',          'james',       'Butch James',         'rsa'],
  ['PHILANDER',      'philander',   'Vernon Philander',    'rsa'],
  ['DU PREEZ',       'du-preez',    'Fourie du Preez',     'rsa'],
  ['LARA',           'lara',        'Brian Lara',          'world'],
  ['Barty',          'barty',       'Ash Barty',           'world'],
  ['Yorke',          'yorke',       'Dwight Yorke',        'world'],
  ['Pollock',        'pollock',     'Shaun Pollock',       'rsa'],
  ['SINGH',          'singh',       'Yuvraj Singh',        'world'],
  ['Shalk Burger',   'burger',      'Schalk Burger',       'rsa'],
  ['Gregan',         'gregan',      'George Gregan',       'world'],
  ['Jimmy Anderson', 'anderson',    'Jimmy Anderson',      'world'],
]

/** Framing overrides where the default misreads a portrait. Olazábal's file
 *  is already cropped tight and he wears a cap, so the figure height
 *  understates his head and the circle cut his mouth off. */
const OVERRIDE = { olazabal: { scale: 0.62, pad: 0.04 } }

const TEAM_BG = { rsa: { r: 0x34, g: 0x52, b: 0x31 }, world: { r: 0x2b, g: 0x7d, b: 0xe9 } }
const OUT_DIR = 'public/marketing/icons/headshots'
const SIZE = 160

async function headBox(file, over = {}) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: ch } = info
  const alpha = (x, y) => data[(y * w + x) * ch + ch - 1]
  let top = h, bottom = 0, left = w, right = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (alpha(x, y) > 24) {
      if (y < top) top = y
      if (y > bottom) bottom = y
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  const figureH = bottom - top
  const slice = Math.round(figureH * 0.16)
  let sum = 0, n = 0
  for (let y = top; y < top + slice; y++) for (let x = left; x <= right; x++) {
    if (alpha(x, y) > 24) { sum += x; n++ }
  }
  const cx = n ? Math.round(sum / n) : Math.round((left + right) / 2)
  const side = Math.round(figureH * (over.scale ?? 0.42))
  const pad = Math.round(side * (over.pad ?? 0.10))
  return {
    left: Math.max(0, Math.min(w - side, Math.round(cx - side / 2))),
    top: Math.max(0, top - pad),
    width: Math.min(side, w),
    height: Math.min(side, h),
  }
}

const dir = process.argv[2]
if (!dir) { console.error('Usage: node scripts/crop-icon-heads.mjs <dir-of-source-pngs>'); process.exit(1) }
const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png'))

for (const [fragment, slug, name, team] of MAP) {
  const file = files.find(f => f.includes(fragment))
  if (!file) { console.log(`no source for ${name} — skipped`); continue }
  const box = await headBox(join(dir, file), OVERRIDE[slug])
  const head = await sharp(join(dir, file)).extract(box).resize(SIZE, SIZE, { fit: 'cover' }).png().toBuffer()
  await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { ...TEAM_BG[team], alpha: 1 } } })
    .composite([{ input: head }])
    .webp({ quality: 82 })
    .toFile(join(OUT_DIR, `${slug}.webp`))
  console.log(`${slug.padEnd(12)} ${team.padEnd(6)} ${box.width}px head`)
}
