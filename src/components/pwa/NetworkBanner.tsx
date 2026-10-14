'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { browserOnline, subscribeTimeoutStreak, timeoutStreakCount } from '@/lib/net/online'

/**
 * One line over every screen when the phone has no signal, or a slow one.
 *
 * Offline is the browser's word (reliable when it says no). Slow is either
 * the connection API's own estimate (2g) or two requests in a row that
 * timed out, which is what a golfer on the far side of the course sees
 * before the browser admits anything. The shot and the result stay on the
 * phone either way (docs/low-signal.md); the banner says so, so nobody
 * re-records or taps Pay again.
 */
type NetworkInformationLike = { effectiveType?: string; addEventListener?: (t: 'change', cb: () => void) => void; removeEventListener?: (t: 'change', cb: () => void) => void }

function connection(): NetworkInformationLike | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection ?? null
}

function subscribeOnline(cb: () => void) {
  return browserOnline.subscribe(() => cb())
}

export default function NetworkBanner() {
  const online = useSyncExternalStore(subscribeOnline, () => browserOnline.isOnline(), () => true)
  const streak = useSyncExternalStore(subscribeTimeoutStreak, timeoutStreakCount, () => 0)
  const [slowType, setSlowType] = useState(false)

  useEffect(() => {
    const c = connection()
    if (!c) return
    const read = () => setSlowType(c.effectiveType === '2g' || c.effectiveType === 'slow-2g')
    read()
    c.addEventListener?.('change', read)
    return () => c.removeEventListener?.('change', read)
  }, [])

  if (!online) {
    return (
      <div className="net-banner net-banner--offline" role="status" aria-live="polite">
        <span>No signal · your shot stays on your phone</span>
      </div>
    )
  }
  if (slowType || streak >= 2) {
    return (
      <div className="net-banner net-banner--slow" role="status" aria-live="polite">
        <span>Slow connection · we keep trying</span>
      </div>
    )
  }
  return null
}
