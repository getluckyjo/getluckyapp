'use client'

import { useSyncExternalStore } from 'react'

const QUERY = '(display-mode: standalone)'

function subscribe(cb: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

function read(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia(QUERY).matches || nav.standalone === true
}

/**
 * True when the app is running from the home screen (Android: display-mode
 * standalone; iOS: navigator.standalone). False during server render and in
 * a browser tab. Use it to hide "install the app" UI and to adjust layout
 * that only makes sense in one of the two modes.
 */
export function useIsStandalone(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}
