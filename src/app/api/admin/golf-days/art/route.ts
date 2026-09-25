/**
 * POST /api/admin/golf-days/art   (multipart: file)
 * Returns: { hero: { src, alt, width, height, kind }, palette: { ink, accent, paper, page } }
 *
 * A golf day's picture, uploaded in /admin/golf-days: a host's photo or
 * logo. It is turned upright, resized to a WebP of at most 1 000 px wide
 * (900 for a logo), and stored in the public golf-day-art bucket
 * (migration 031). The answer says whether it looks like a logo (it has a
 * transparent background, so it is shown whole) or a photo, and suggests
 * colours from it. Nothing is saved on a golf day until the admin saves
 * the form with it.
 */
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { ART_BUCKET, isArtSrc, suggestPalette } from '@/lib/golf-days/look'

/** Uploads are resized in the browser first; this is the ceiling after that. */
const MAX_BYTES = 4 * 1024 * 1024
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
/** The bucket's own limit (031). */
const MAX_STORED = 2 * 1024 * 1024
/** A picture with more than this share of see-through pixels is a logo. */
const LOGO_TRANSPARENCY = 0.03

const refuse = (error: string, status = 400) => NextResponse.json({ error, code: 'INVALID_INPUT' }, { status })

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof Blob) || file.size === 0) return refuse('Choose a picture to upload.')
  if (!TYPES.has(file.type)) return refuse('Use a JPEG, PNG or WebP picture.')
  if (file.size > MAX_BYTES) return refuse('That picture is too big. Use one under 4 MB.', 413)

  try {
    const input = Buffer.from(await file.arrayBuffer())
    const upright = () => sharp(input, { failOn: 'error' }).rotate()

    let thumb: Buffer
    try {
      thumb = await upright().resize({ width: 96, withoutEnlargement: true }).ensureAlpha().raw().toBuffer()
    } catch {
      return refuse('That file could not be read as a picture.')
    }
    let clear = 0
    for (let i = 3; i < thumb.length; i += 4) if (thumb[i] < 10) clear++
    const kind = clear / (thumb.length / 4) > LOGO_TRANSPARENCY ? 'logo' : 'photo'
    const palette = suggestPalette(thumb)

    const width = kind === 'logo' ? 900 : 1000
    let quality = kind === 'logo' ? 88 : 82
    let out = await upright().resize({ width, withoutEnlargement: true }).webp({ quality, alphaQuality: 100 }).toBuffer({ resolveWithObject: true })
    while (out.data.length > MAX_STORED && quality > 50) {
      quality -= 12
      out = await upright().resize({ width, withoutEnlargement: true }).webp({ quality, alphaQuality: 90 }).toBuffer({ resolveWithObject: true })
    }

    const path = `${randomUUID()}.webp`
    const bucket = auth.adminClient.storage.from(ART_BUCKET)
    const { error } = await bucket.upload(path, out.data, { contentType: 'image/webp', cacheControl: '31536000', upsert: false })
    if (error) throw error
    const src = bucket.getPublicUrl(path).data.publicUrl
    if (!isArtSrc(src)) throw new Error(`golf day art landed outside the art bucket: ${src}`)

    log.info('admin.golf_days.art_uploaded', { path, kind, bytes: out.data.length, by: auth.user.id })
    return NextResponse.json({
      hero: { src, alt: '', width: out.info.width, height: out.info.height, kind },
      palette,
    }, { status: 201 })
  } catch (err) {
    return apiError('admin.golf_days.art_failed', err, { path: 'admin_review' })
  }
}
