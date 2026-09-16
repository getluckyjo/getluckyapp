/**
 * One place to send product events. Backed by Vercel Web Analytics
 * (`@vercel/analytics`), which is already part of the Vercel Pro plan the
 * app runs on. Enable it once in the dashboard (project → Analytics) and
 * events appear there; until then `track` is a no-op.
 *
 * Event names are the funnel (docs/pwa-plan.md). Keep values small and
 * never personal: no emails, no names, no bet ids.
 */
import { track as vercelTrack } from '@vercel/analytics'

export type AnalyticsEvent =
  | 'session_start'
  | 'pwa_install'
  | 'pwa_install_prompt_shown'
  | 'pwa_install_prompt_dismissed'
  | 'pwa_update_applied'
  | 'course_selected'
  | 'stake_chosen'
  | 'payment_started'
  | 'bet_created'
  | 'result_declared'
  | 'claim_submitted'
  | 'feedback_sent'

type Value = string | number | boolean | null

export function track(event: AnalyticsEvent, data?: Record<string, Value>) {
  if (typeof window === 'undefined') return
  try {
    vercelTrack(event, data)
  } catch {
    // Analytics must never break a flow.
  }
}

/** True when the page runs as an installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true
}
