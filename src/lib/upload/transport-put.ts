/**
 * The browser transport: our two API routes through fetchJson, and the
 * bytes by XHR PUT to the signed URL Supabase Storage issued (progress
 * events, which fetch does not give). The stall timer is paused while the
 * page is hidden: iOS suspends a background XHR, and the old 45 s stall
 * aborted a perfectly good upload the moment the golfer switched apps.
 */
import type { CaptureInput } from '@/lib/claims/capture'
import { NetError, fetchJson } from '@/lib/net/fetch-json'
import { classifyHttp } from './manager'
import { TransportError, type PrepareOutcome, type SealOutcome, type UploadTransport } from './types'

/** No upload progress for this long (while visible) and the attempt is abandoned so the retry can show. */
export const UPLOAD_STALL_MS = 45_000
/** The whole PUT, however slowly it moves. */
export const UPLOAD_TIMEOUT_MS = 5 * 60_000

function fromNetError(err: unknown): TransportError {
  if (err instanceof NetError) {
    if (err.kind === 'offline') return new TransportError('offline', err.message)
    if (err.kind === 'network') return new TransportError('network', err.message)
    if (err.kind === 'timeout') return new TransportError('timeout', err.message)
    if (err.kind === 'rate_limited') return new TransportError('rate_limited', err.message, undefined, err.retryAfterMs)
    if (err.kind === 'http') return classifyHttp(err.status ?? 500, err.code)
  }
  return new TransportError('server', err instanceof Error ? err.message : String(err))
}

export const putTransport: UploadTransport = {
  async seal(betId): Promise<SealOutcome> {
    try {
      await fetchJson('/api/videos/uploaded', { method: 'POST', body: { betId }, timeoutMs: 60_000, waitForOnlineMs: 0 })
      return { kind: 'sealed' }
    } catch (err) {
      if (err instanceof NetError && err.kind === 'http' && err.status === 404 && err.code === 'FOOTAGE_MISSING') return { kind: 'missing' }
      throw fromNetError(err)
    }
  },

  async prepare(betId, mimeType, capture: CaptureInput | null): Promise<PrepareOutcome> {
    try {
      const { data } = await fetchJson<{ signedUrl: string; storagePath: string }>('/api/videos/upload-url', {
        method: 'POST', body: { betId, mimeType, ...(capture ? { capture } : {}) }, timeoutMs: 20_000, waitForOnlineMs: 0,
      })
      if (!data?.signedUrl) throw new TransportError('server', 'No upload slot')
      return { kind: 'slot', signedUrl: data.signedUrl, storagePath: data.storagePath }
    } catch (err) {
      if (err instanceof NetError && err.kind === 'http' && err.status === 409 && err.code === 'FOOTAGE_SEALED') return { kind: 'sealed' }
      throw fromNetError(err)
    }
  },

  put(signedUrl, blob, mimeType, onProgress, signal) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', signedUrl)
      // The bare type: the bucket's allow-list (migration 042) names
      // video/mp4 and video/webm, not every codecs variant.
      xhr.setRequestHeader('Content-Type', mimeType.split(';')[0].trim())
      let stall: ReturnType<typeof setTimeout> | undefined
      const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
      const armStall = () => {
        if (stall) clearTimeout(stall)
        if (hidden()) return
        stall = setTimeout(() => xhr.abort(), UPLOAD_STALL_MS)
      }
      const onVisibility = () => { if (hidden()) { if (stall) clearTimeout(stall); stall = undefined } else armStall() }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
      const cleanup = () => {
        if (stall) clearTimeout(stall)
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
        signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => xhr.abort()
      signal.addEventListener('abort', onAbort, { once: true })
      xhr.timeout = UPLOAD_TIMEOUT_MS
      xhr.upload.onprogress = e => {
        armStall()
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => { cleanup(); if (xhr.status < 300) resolve(); else reject(classifyStorage(xhr.status)) }
      xhr.onerror = () => { cleanup(); reject(new TransportError(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'network', 'The upload was interrupted')) }
      xhr.ontimeout = () => { cleanup(); reject(new TransportError('timeout', 'The upload timed out')) }
      xhr.onabort = () => { cleanup(); reject(new TransportError(signal.aborted ? 'network' : 'stalled', signal.aborted ? 'The upload was stopped' : 'The upload stalled')) }
      armStall()
      xhr.send(blob)
    })
  },
}

/** Storage's own answers to the PUT: the slot can expire (403/400) or the object be rejected (413). */
function classifyStorage(status: number): TransportError {
  if (status === 413) return new TransportError('blocked', 'The clip is too large', 'too_large')
  if (status === 400 || status === 403 || status === 409) return new TransportError('server', `Storage refused the upload (${status})`)
  return new TransportError('server', `Storage answered ${status}`)
}
