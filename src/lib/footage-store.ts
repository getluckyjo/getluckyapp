/**
 * The shot, kept on the phone until the server has it.
 *
 * Footage lived only in React memory between the recorder and the confirm
 * screen. A reload, a tab the browser threw away, or an app swipe while the
 * upload was still running lost the only copy of a shot nobody can replay.
 * This store keeps the blob, the recorder's report and the session it
 * belongs to in IndexedDB the moment recording stops, so the BetProvider
 * can put the session back together after a restart and finish the upload.
 *
 * One record per bet, keyed by bet id. Records older than FOOTAGE_TTL_MS
 * are pruned on the next start. Every call swallows storage failures: a
 * private window or a full disk means no recovery, never a broken flow.
 */
import type { CaptureInput } from '@/lib/claims/capture'

const DB_NAME = 'getlucky-footage'
const STORE = 'footage'
const VERSION = 1

/**
 * How long a shot stays on the phone with nothing done about it. A week:
 * the footage window on the server is the play window plus seven days
 * (src/lib/claims/footage-window.ts), and a phone that was off the grid
 * for a weekend must still be able to deliver.
 */
export const FOOTAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface StoredSession {
  selectedCourse: unknown
  selectedHole: unknown
  selectedTier: string | null
  prize: number | null
  prizeCurrency: 'ZAR' | 'USD'
}

export interface StoredFootage {
  betId: string
  blob: Blob
  mimeType: string
  capture: CaptureInput | null
  session: StoredSession
  /** Epoch ms. */
  savedAt: number
  /** The server has hashed this footage; nothing left to upload. */
  sealed: boolean
}

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && !!indexedDB
  } catch {
    return false
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

async function open(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return null
  try {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'betId' })
    }
    return await request(req)
  } catch {
    return null
  }
}

/** Keep this shot on the phone. True when it was written. */
export async function saveFootage(record: StoredFootage): Promise<boolean> {
  const db = await open()
  if (!db) return false
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(record)
    await done(tx)
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

/** Every shot still on the phone. */
export async function loadFootage(): Promise<StoredFootage[]> {
  const db = await open()
  if (!db) return []
  try {
    const tx = db.transaction(STORE, 'readonly')
    const rows = await request(tx.objectStore(STORE).getAll())
    return (rows as StoredFootage[]).filter(r => r && typeof r.betId === 'string' && r.blob instanceof Blob)
  } catch {
    return []
  } finally {
    db.close()
  }
}

/** The server has the hash: the local copy is a replay now, not a backup. */
export async function markFootageSealed(betId: string): Promise<void> {
  const db = await open()
  if (!db) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const row = (await request(store.get(betId))) as StoredFootage | undefined
    if (row) store.put({ ...row, sealed: true })
    await done(tx)
  } catch {
    /* nothing to do: the next start re-checks with the server */
  } finally {
    db.close()
  }
}

/** Delete the local copy only once the server has the hash; an unsealed shot is the upload manager's to finish. */
export async function deleteFootageIfSealed(betId: string): Promise<boolean> {
  const db = await open()
  if (!db) return false
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const row = (await request(store.get(betId))) as StoredFootage | undefined
    if (!row || !row.sealed) { await done(tx); return false }
    store.delete(betId)
    await done(tx)
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

export async function deleteFootage(betId: string): Promise<void> {
  const db = await open()
  if (!db) return
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(betId)
    await done(tx)
  } catch {
    /* a stale row costs a few megabytes until the next prune */
  } finally {
    db.close()
  }
}

/** Inside its time, with a sane timestamp. */
export function isFreshFootage(r: StoredFootage, now: number): boolean {
  return Number.isFinite(r.savedAt) && now - r.savedAt < FOOTAGE_TTL_MS && now - r.savedAt >= 0
}

/**
 * What to do with what the phone still holds: restore the newest shot that
 * is not past its time into the session, keep every other unsealed one
 * uploading, and name the stale ones for deletion. Pure, so it can be
 * tested without a browser.
 */
export function pickRecovery(records: StoredFootage[], now: number): { restore: StoredFootage | null; keepUploading: string[]; stale: string[] } {
  const fresh = records.filter(r => isFreshFootage(r, now))
  const newest = fresh.reduce<StoredFootage | null>((best, r) => (best === null || r.savedAt > best.savedAt ? r : best), null)
  const keepUploading = fresh.filter(r => !r.sealed).map(r => r.betId)
  const stale = records.filter(r => !isFreshFootage(r, now)).map(r => r.betId)
  return { restore: newest, keepUploading, stale }
}
