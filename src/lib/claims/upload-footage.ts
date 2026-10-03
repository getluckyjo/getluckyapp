import type { CaptureInput } from './capture'

/**
 * Footage upload, as the player's phone runs it: ask for a slot, PUT the
 * bytes to it, then ask the server to seal what landed. Kept out of
 * BetContext so the retry rules can be tested without a browser.
 *
 * A retry has to work after the result is declared. The Miss screen marks
 * the bet `miss` as soon as it opens, and from then on /api/videos/upload-url
 * refuses a new slot (the bet is no longer active), so the phone keeps the
 * slot it was first given and reuses it. Supabase's signed upload URLs last
 * two hours. Sealing does not depend on the bet's status.
 */

export interface FootageJob {
  betId: string
  blob: Blob
  mimeType: string
  /** The recorder's report. Sent with every slot request so a retry never blanks it. */
  capture?: CaptureInput
}

/** What came back from the PUT to the signed URL. */
export interface PutResult {
  status: number
  body: string
}

export interface FootageDeps {
  fetch: typeof fetch
  put: (url: string, blob: Blob, mimeType: string, onProgress: (pct: number) => void) => Promise<PutResult>
  /** betId → the signed upload URL the server issued for it. */
  slots: Map<string, string>
}

/**
 * The object is already at the path: an earlier PUT landed but the seal
 * never ran. Storage answers 409, or 400 carrying a 409 "Duplicate" body.
 */
export function alreadyStored(r: PutResult): boolean {
  return r.status === 409 || (r.status === 400 && /duplicate|already exists/i.test(r.body))
}

export async function uploadFootage(job: FootageJob, deps: FootageDeps, onProgress: (pct: number) => void): Promise<void> {
  const signedUrl = (await requestSlot(job, deps)) ?? deps.slots.get(job.betId)
  if (!signedUrl) throw new Error('No upload slot')

  const put = await deps.put(signedUrl, job.blob, job.mimeType, onProgress)
  if (put.status >= 300 && !alreadyStored(put)) throw new Error(`Upload ${put.status}`)

  // The server reads the object back and records its hash, size and its own
  // timestamp on the bet. Without this the footage is uploaded but not
  // sealed, so a failure here is an upload failure.
  const seal = await deps.fetch('/api/videos/uploaded', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ betId: job.betId }),
  })
  if (!seal.ok) throw new Error(`Seal ${seal.status}`)
}

/** A fresh slot from the server, remembered for retries; null when it won't give one. */
async function requestSlot(job: FootageJob, deps: FootageDeps): Promise<string | null> {
  try {
    const res = await deps.fetch('/api/videos/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ betId: job.betId, mimeType: job.mimeType, ...(job.capture ? { capture: job.capture } : {}) }),
    })
    if (!res.ok) return null
    const { signedUrl } = (await res.json()) as { signedUrl?: string }
    if (!signedUrl) return null
    deps.slots.set(job.betId, signedUrl)
    return signedUrl
  } catch {
    // Offline: fall back to the slot already held, if any.
    return null
  }
}

/** The browser PUT, with progress. Settles on every outcome, including abort. */
export function xhrPut(url: string, blob: Blob, mimeType: string, onProgress: (pct: number) => void): Promise<PutResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', mimeType)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => resolve({ status: xhr.status, body: typeof xhr.responseText === 'string' ? xhr.responseText : '' })
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.onabort = () => reject(new Error('Upload aborted'))
    xhr.ontimeout = () => reject(new Error('Upload timed out'))
    xhr.send(blob)
  })
}
