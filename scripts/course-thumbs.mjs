#!/usr/bin/env node
/**
 * Thumbnails for the select-course cards.
 *
 * The cards show an 86 px photo; the full-size course photos under
 * public/marketing/courses are 150 to 400 KB each, five megabytes for the
 * list, which on a golf course is the difference between a list and a
 * spinner. This writes a 260 px WebP (2× the card) next to each one, under
 * thumbs/, and src/lib/course-photo.ts serves the thumb to the list.
 *
 *   npm run photos:thumbs
 *
 * Idempotent: a thumb newer than its photo is left alone.
 */
import { readdir, stat, mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const SRC = path.resolve('public/marketing/courses')
const OUT = path.join(SRC, 'thumbs')
const WIDTH = 260
const QUALITY = 70

await mkdir(OUT, { recursive: true })
const files = (await readdir(SRC)).filter(f => /\.(jpe?g|png|webp)$/i.test(f))
let written = 0
for (const file of files) {
  const from = path.join(SRC, file)
  const to = path.join(OUT, `${path.parse(file).name}.webp`)
  const fresh = await stat(to).then(s => s.mtimeMs, () => 0)
  if (fresh >= (await stat(from)).mtimeMs) continue
  await sharp(from).rotate().resize({ width: WIDTH, height: WIDTH, fit: 'cover', position: 'attention' }).webp({ quality: QUALITY }).toFile(to)
  const size = (await stat(to)).size
  console.log(`${file} → thumbs/${path.parse(file).name}.webp (${(size / 1024).toFixed(1)} KB)`)
  written++
}
console.log(`${written} thumb${written === 1 ? '' : 's'} written, ${files.length - written} up to date.`)
