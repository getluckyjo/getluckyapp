/**
 * Ops alerts for the handful of events that need a human within the hour:
 * a payment callback that could not be recorded, a claim that could not be
 * submitted, a 5xx on a money path.
 *
 * Two channels, both best-effort and never allowed to throw into the caller:
 *  1. Sentry, tagged `alert=true` and level fatal, which the alert rules in
 *     docs/stage-2-safety-net.md route to email.
 *  2. A direct email through Resend to OPS_ALERT_EMAIL, so the alert reaches
 *     an inbox even before Sentry is configured or if Sentry is down.
 *
 * Alerts are deliberately rare. Anything that fires more than a few times a
 * day belongs in `log.error` (Sentry aggregates it) rather than here.
 *
 * The email leg is throttled: one email per event name per EMAIL_THROTTLE_MS
 * per function instance. An outage that fires the same alert a thousand
 * times in a minute (Resend refusing auth emails, say) would otherwise send
 * a thousand emails through the same refused provider and eat the quota the
 * golfers need. Sentry and the log still see every occurrence.
 */
import * as Sentry from '@sentry/nextjs'
import { log, errorMessage, type MoneyPath } from './log'
import { FROM_ADDRESS } from '@/lib/email/from'

const OPS_EMAIL = (process.env.OPS_ALERT_EMAIL ?? 'johannes@getluckygolfclub.com').trim()

export const EMAIL_THROTTLE_MS = 5 * 60_000
const lastEmailed = new Map<string, number>()

/** Test hook: forget what has been emailed. */
export function resetAlertThrottle() { lastEmailed.clear() }

/** Should an email go out for this event now? Records the send when it says yes. */
export function emailDue(event: string, now = Date.now()): boolean {
  const last = lastEmailed.get(event)
  if (last !== undefined && now - last < EMAIL_THROTTLE_MS) return false
  lastEmailed.set(event, now)
  return true
}

export interface OpsAlert {
  /** Stable event name, e.g. `payfast.itn.ledger_write_failed`. */
  event: string
  path: MoneyPath
  /** One line a person can act on. */
  summary: string
  /** Ids, amounts, statuses. No secrets, no raw payloads. */
  details?: Record<string, unknown>
  err?: unknown
}

export async function alertOps(alert: OpsAlert): Promise<void> {
  const details = { ...(alert.details ?? {}), ...(alert.err !== undefined ? { error: errorMessage(alert.err) } : {}) }

  // Always log; log.error also captures to Sentry with the money_path tag.
  log.error(alert.event, alert.err ?? alert.summary, { path: alert.path, ...details, alert: true })

  Sentry.withScope(scope => {
    scope.setTag('alert', 'true')
    scope.setTag('money_path', alert.path)
    scope.setLevel('fatal')
    scope.setContext('alert', { summary: alert.summary, ...details })
    Sentry.captureMessage(`[ALERT] ${alert.event}: ${alert.summary}`, 'fatal')
  })

  if (emailDue(alert.event)) await sendEmail(alert, details)
  else log.warn('alerts.email_throttled', { event: alert.event })
}

async function sendEmail(alert: OpsAlert, details: Record<string, unknown>) {
  if (!process.env.RESEND_API_KEY || !OPS_EMAIL) return
  try {
    const { resend } = await import('@/lib/resend')
    const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown'
    const lines = Object.entries(details).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: OPS_EMAIL,
      subject: `[Get Lucky ${env}] ${alert.event}: ${alert.summary}`.slice(0, 200),
      text: [
        `Environment: ${env}`,
        `Path: ${alert.path}`,
        `Event: ${alert.event}`,
        `When: ${new Date().toISOString()}`,
        '',
        alert.summary,
        '',
        ...lines,
        '',
        'Sent by src/lib/observability/alerts.ts. Runbook: docs/stage-2-safety-net.md',
      ].join('\n'),
    })
  } catch (err) {
    // The alert is already in the logs and Sentry; an email failure must not
    // turn into a second failure in the caller.
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'alerts.email_failed', error: errorMessage(err) }))
  }
}
