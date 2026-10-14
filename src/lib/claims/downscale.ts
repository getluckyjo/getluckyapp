/**
 * A phone photo of a certificate is 3 to 8 MB; the reviewer needs to read
 * it, not frame it. Before the upload the image is redrawn with its long
 * edge at most MAX_EDGE pixels as a JPEG, which is a few hundred
 * kilobytes: on a golf course that is the difference between a document
 * that lands and one that times out. PDFs and anything the browser cannot
 * decode pass through untouched.
 */
export const MAX_EDGE = 1600
export const JPEG_QUALITY = 0.8

export async function downscaleImage(file: File | Blob, opts: { maxEdge?: number; quality?: number } = {}): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  const maxEdge = opts.maxEdge ?? MAX_EDGE
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file // HEIC on a browser that cannot decode it, or a corrupt file: let the server see it as it is
  }
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.type === 'image/jpeg' && file.size < 1_500_000) return file
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', opts.quality ?? JPEG_QUALITY))
    return blob && blob.size < file.size ? blob : file
  } finally {
    bitmap.close()
  }
}
