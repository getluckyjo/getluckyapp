'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '@/context/AuthContext'

/** The golf day that takes the Icons tab's place for this player. */
export interface GolfDayTab { slug: string; tabLabel: string }

/*
 * One answer per signed-in player for the life of the page, shared by every
 * tab bar (each screen renders its own, so a per-component fetch would run
 * on every navigation). Keyed by user, so a sign-out never shows the last
 * player's golf day.
 */
let state: { userId: string; tab: GolfDayTab | null } | null = null
let inflight: string | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Set the answer directly: the golf day screen does, the moment a player joins. */
export function setGolfDayTab(userId: string, tab: GolfDayTab | null) {
  state = { userId, tab }
  for (const listener of listeners) listener()
}

export function useGolfDayTab(): GolfDayTab | null {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const snapshot = useSyncExternalStore(subscribe, () => state, () => null)

  useEffect(() => {
    if (!userId || state?.userId === userId || inflight === userId) return
    inflight = userId
    fetch('/api/golf-days')
      .then(r => (r.ok ? r.json() : null))
      .then((data: { tab?: GolfDayTab | null } | null) => {
        if (inflight !== userId) return
        inflight = null
        // A failed answer is not "no golf day": leave it unset so the next screen asks again.
        if (data) setGolfDayTab(userId, data.tab ?? null)
      })
      .catch(() => { if (inflight === userId) inflight = null })
  }, [userId])

  return userId && snapshot?.userId === userId ? snapshot.tab : null
}
