/**
 * The one upload manager for the browser. Built lazily the first time a
 * screen or the boot component asks, from the real transport, the
 * IndexedDB footage store and the browser's online signal.
 */
import { browserOnline } from '@/lib/net/online'
import { isFreshFootage, loadFootage, markFootageSealed, saveFootage } from '@/lib/footage-store'
import { createClient } from '@/lib/supabase/client'
import { createUploadManager, type UploadManager } from './manager'
import { putTransport } from './transport-put'

let instance: UploadManager | null = null

export function getUploadManager(): UploadManager {
  if (instance) return instance
  instance = createUploadManager({
    transport: putTransport,
    online: browserOnline,
    store: {
      save: r => saveFootage({ betId: r.betId, blob: r.blob, mimeType: r.mimeType, capture: r.capture, session: { selectedCourse: null, selectedHole: null, selectedTier: null, prize: null, prizeCurrency: 'ZAR' }, savedAt: r.savedAt, sealed: false }),
      load: async () => (await loadFootage()).filter(r => isFreshFootage(r, Date.now())).map(r => ({ betId: r.betId, blob: r.blob, mimeType: r.mimeType, capture: r.capture, savedAt: r.savedAt, sealed: r.sealed })),
      markSealed: markFootageSealed,
    },
    onSignedIn: cb => {
      try {
        const { data } = createClient().auth.onAuthStateChange(event => {
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') cb()
        })
        return () => data.subscription.unsubscribe()
      } catch {
        return () => {}
      }
    },
    log: (event, fields) => { console.info(`[upload] ${event}`, fields) },
  })
  if (typeof document !== 'undefined') {
    const wake = () => instance?.kick()
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake() })
    window.addEventListener('pageshow', wake)
    window.addEventListener('focus', wake)
  }
  return instance
}

export type { UploadState, UploadStatus, BlockedReason } from './types'
