'use client'

import { useEffect } from 'react'
import { isStandalone, track } from '@/lib/analytics'

/**
 * One `session_start` per app open, tagged with how it was opened:
 * installed app or browser tab, and whether the launch came from the
 * home-screen icon (the manifest's start_url carries `source=pwa`). Also
 * records the `appinstalled` event Chrome fires after an install.
 */
export default function SessionTracker() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromIcon = params.get('source') === 'pwa'
    track('session_start', { standalone: isStandalone(), from_icon: fromIcon })

    const onInstalled = () => track('pwa_install')
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])
  return null
}
