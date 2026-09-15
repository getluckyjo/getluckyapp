'use client'

import { Analytics } from '@vercel/analytics/next'
import ServiceWorkerManager from './ServiceWorkerManager'
import SessionTracker from './SessionTracker'
import InstallPrompt from './InstallPrompt'
import FeedbackButton from './FeedbackButton'

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
      <FeedbackButton />
      <Analytics />
    </>
  )
}
