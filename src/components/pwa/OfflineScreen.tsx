'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}
const readOnline = () => navigator.onLine
const readServer = () => true

/**
 * Branded offline page. Deep green, the lockup, one message, one button.
 * When the connection comes back it goes back to where the golfer was
 * trying to go (the worker serves this page *at* that URL, so a reload is
 * enough); the button does the same by hand.
 */
export default function OfflineScreen() {
  const online = useSyncExternalStore(subscribe, readOnline, readServer)
  const [retrying, setRetrying] = useState(false)

  // The worker served this page at the URL the golfer wanted, so once the
  // connection is back a reload lands them there.
  useEffect(() => {
    const goBack = () => window.location.reload()
    window.addEventListener('online', goBack)
    return () => window.removeEventListener('online', goBack)
  }, [])

  function retry() {
    setRetrying(true)
    window.location.reload()
  }

  return (
    <main className="offline">
      <div className="offline-card">
        {/* Plain <img>: next/image would route through /_next/image, which needs the network. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-lockup.svg" alt="Get Lucky Hole-in-1 Challenge" className="offline-lockup" draggable={false} />
        <h1 className="offline-title">You&rsquo;re offline</h1>
        <p className="offline-copy">
          {online
            ? 'We could not reach Get Lucky just now. We will reconnect the moment your signal is back.'
            : 'No signal out here. Your place is saved; we will reconnect the moment it comes back.'}
        </p>
        <button type="button" className="btn-lime offline-retry" onClick={retry} disabled={retrying}>
          {retrying ? 'Reconnecting…' : 'Try again'}
        </button>
        <p className="offline-hint">A recorded shot stays on your phone until it has uploaded.</p>
      </div>
    </main>
  )
}
