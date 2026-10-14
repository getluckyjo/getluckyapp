'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'

/**
 * The screens between the tee and the claim, fetched once per session
 * after sign-in so each one opens on the course without the network:
 * the HTML through the service worker's page cache (it fetches them as
 * the signed-in golfer and keeps a plain 200), and the route payloads
 * through Next's prefetch, which the worker keeps for a day.
 *
 * Kept in step with the list in src/app/sw.ts.
 */
export const PLAY_ROUTES = ['/home', '/select-course', '/choose-stake', '/record', '/confirm', '/result/miss', '/result/claim', '/verify', '/history'] as const

const FLAG = 'glg:warmed:v1'

export default function PlayRoutesWarmup() {
  const router = useRouter()
  const { user } = useAuth()

  useEffect(() => {
    if (!user || typeof window === 'undefined') return
    try { if (sessionStorage.getItem(FLAG)) return } catch { /* storage blocked: warm anyway */ }
    const run = () => {
      try { sessionStorage.setItem(FLAG, '1') } catch { /* same */ }
      for (const route of PLAY_ROUTES) router.prefetch(route)
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then(reg => reg.active?.postMessage({ type: 'WARM_PAGES', urls: [...PLAY_ROUTES] }))
          .catch(() => {})
      }
    }
    // After the screen has settled; the first paint comes first.
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(run, { timeout: 8_000 })
      return () => w.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(run, 3_000)
    return () => window.clearTimeout(id)
  }, [user, router])

  return null
}
