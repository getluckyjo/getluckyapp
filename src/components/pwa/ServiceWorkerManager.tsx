'use client'

import { useEffect, useState } from 'react'
import { Serwist } from '@serwist/window'
import { track } from '@/lib/analytics'

const SW_URL = '/serwist/sw.js'
const ENABLED = process.env.NODE_ENV === 'production'
/** How long to wait for the new worker to take control before reloading anyway. */
const UPDATE_FALLBACK_MS = 3000

let reloading = false
/** One reload onto the new build, however many signals ask for it. */
function reloadOnce() {
  if (reloading) return
  reloading = true
  window.location.reload()
}

/**
 * Registers the service worker in production and owns the update flow.
 *
 * A new worker never takes over on its own (sw.ts sets skipWaiting: false).
 * When one is waiting we show the toast; tapping it hides the toast at once
 * and tells the waiting worker to skip waiting, and when it takes control
 * the page reloads onto the new build. Should that signal not come, the
 * page reloads anyway after UPDATE_FALLBACK_MS rather than leave the player
 * on the old build. Nobody gets stuck on a stale cache, and nobody is
 * reloaded under their feet mid-claim.
 *
 * In development any worker left behind by a production build on the same
 * origin is unregistered, so local testing never hits a stale cache.
 */
export default function ServiceWorkerManager() {
  const [waiting, setWaiting] = useState<Serwist | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    if (!ENABLED) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => Promise.all(regs.map(r => r.unregister())))
        .then(() => caches?.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))))
        .catch(() => {})
      return
    }

    const sw = new Serwist(SW_URL, { scope: '/' })

    sw.addEventListener('waiting', () => setWaiting(sw))
    sw.addEventListener('controlling', event => {
      // `isUpdate` is false on the very first install; only reload for a real update.
      if (event.isUpdate) reloadOnce()
    })
    sw.register().catch(() => {})

    // Look for a newer build whenever the app comes back to the foreground.
    const onVisible = () => { if (document.visibilityState === 'visible') sw.update().catch(() => {}) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  if (!waiting) return null

  function update() {
    const sw = waiting
    // The toast goes the moment it is tapped; the reload follows by itself.
    setWaiting(null)
    track('pwa_update_applied')
    sw?.messageSkipWaiting()
    setTimeout(reloadOnce, UPDATE_FALLBACK_MS)
  }

  return (
    <div className="pwa-toast" role="status" aria-live="polite">
      <span className="pwa-toast-text">New version available</span>
      <button type="button" className="pwa-toast-btn" onClick={update}>Update</button>
    </div>
  )
}
