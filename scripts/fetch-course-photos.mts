#!/usr/bin/env -S npx tsx
/**
 * Bring the partner course photos into the repo.
 *
 * For every REMOTE_PHOTOS entry in src/lib/course-photo.ts that has no
 * committed file yet, download the original, resize it to at most 1200 px
 * wide, and write public/marketing/courses/<slug>.jpg (JPEG, quality 78,
 * about 150–300 KB). Then add the keyword to LOCAL_PHOTOS in that file
 * (the script prints the lines) and commit the images.
 *
 * Run on a machine with normal internet access:  npm run photos:fetch
 * Idempotent: existing files are left alone. Pass --force to redo them.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { LOCAL_PHOTOS, REMOTE_PHOTOS } from '../src/lib/course-photo'

const OUT_DIR = join(process.cwd(), 'public', 'marketing', 'courses')
const FORCE = process.argv.includes('--force')
const MAX_WIDTH = 1200

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const localSlugs = new Set(LOCAL_PHOTOS.map(([, slug]) => slug))
  const added: [string, string][] = []

  for (const [keyword, slug, url] of REMOTE_PHOTOS) {
    const file = join(OUT_DIR, `${slug}.jpg`)
    if (existsSync(file) && !FORCE) {
      console.log(`skip    ${slug} (exists)`)
      if (!localSlugs.has(slug)) added.push([keyword, slug])
      continue
    }
    process.stdout.write(`fetch   ${slug} … `)
    const res = await fetch(url, { headers: { 'user-agent': 'GetLuckyGolf photo fetch (approved use)' } })
    if (!res.ok) { console.log(`HTTP ${res.status}, skipped`); continue }
    const input = Buffer.from(await res.arrayBuffer())
    const out = await sharp(input).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer()
    writeFileSync(file, out)
    const meta = await sharp(out).metadata()
    console.log(`${meta.width}x${meta.height}, ${Math.round(out.length / 1024)} KB`)
    if (!localSlugs.has(slug)) added.push([keyword, slug])
  }

  if (added.length) {
    console.log('\nAdd these to LOCAL_PHOTOS in src/lib/course-photo.ts, then commit the images:\n')
    for (const [keyword, slug] of added) console.log(`  ['${keyword}', '${slug}'],`)
  } else {
    console.log('\nNothing to add: every remote photo already has a local copy.')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
