'use client'

import { Analytics } from '@vercel/analytics/next'
import ServiceWorkerManager from './ServiceWorkerManager'
import SessionTracker from './SessionTracker'
import InstallPrompt from './InstallPrompt'
import FeedbackButton from './FeedbackButton'
// Catches Chrome's install dialog from boot, for screens that offer it later.
import '@/lib/pwa/install'

/**
 * The floating feedback button is for a closed beta with testers who know
 * they are testing. A launched app does not wear one: problems are read
 * from the Vercel and Sentry logs instead. Set NEXT_PUBLIC_FEEDBACK=on to
 * show it (build-time, so redeploy after changing it).
 */
const FEEDBACK_ENABLED = process.env.NEXT_PUBLIC_FEEDBACK === 'on'

/**
 * Everything the installed app mounts once, over every screen: the service
 * worker and its update toast, analytics, and the session-start beacon.
 * Install prompts and the feedback button are added by the same component
 * so the root layout stays a one-liner.
 */
export default function PwaChrome() {
  return (
    <>
      <ServiceWorkerManager />
      <SessionTracker />
      <InstallPrompt />
      {FEEDBACK_ENABLED && <FeedbackButton />}
      <Analytics />
    </>
  )
}
