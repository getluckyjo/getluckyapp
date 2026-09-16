'use client'

import { useEffect, useState } from 'react'

export const REFRESH_EVENT = 'gl:refresh'

/** Ask every listening screen to reload its data (pull-to-refresh, "Try again"). */
export function requestRefresh() {
  window.dispatchEvent(new CustomEvent(REFRESH_EVENT))
}

/**
 * A counter that bumps on every refresh request. Put it in the dependency
 * list of the effect that fetches the screen's data and the fetch re-runs.
 */
export function useRefreshSignal(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    window.addEventListener(REFRESH_EVENT, bump)
    return () => window.removeEventListener(REFRESH_EVENT, bump)
  }, [])
  return tick
}
