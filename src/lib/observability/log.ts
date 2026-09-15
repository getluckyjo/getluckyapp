/**
 * Structured logging for the paths where a silent failure costs money.
 *
 * One JSON line per event so Vercel's log drain and Sentry both get something
 * searchable. `event` is a stable dotted name (`payfast.itn.rejected`,
 * `bets.create.insert_failed`) and `fields` is whatever is needed to act on it:
 * ids, statuses, amounts. Never put a token, key or full request body in
 * `fields`.
 *
 * Errors go to Sentry as well as the log. Warnings go to Sentry as
 * breadcrumbs, so when an error is captured the preceding warnings travel
 * with it.
 */
import * as Sentry from '@sentry/nextjs'

type Level = 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>

/** Routes where a failure means a payer or a claimant is stuck. */
export type MoneyPath = 'payfast_itn' | 'payfast_checkout' | 'bets_create' | 'claim' | 'admin_review' | 'auth'

function emit(level: Level, event: string, fields: Fields) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  info(event: string, fields: Fields = {}) {
    emit('info', event, fields)
    Sentry.addBreadcrumb({ category: event, level: 'info', data: fields })
  },

  warn(event: string, fields: Fields = {}) {
    emit('warn', event, fields)
    Sentry.addBreadcrumb({ category: event, level: 'warning', data: fields })
  },

  /**
   * Something failed. `err` may be an Error, a Supabase error object, or a
   * string. `path` tags the event so Sentry alert rules can key on it.
   */
  error(event: string, err: unknown, fields: Fields & { path?: MoneyPath } = {}) {
    const { path, ...rest } = fields
    const message = errorMessage(err)
    emit('error', event, { ...rest, path, error: message })

    Sentry.withScope(scope => {
      scope.setTag('event', event)
      if (path) {
        scope.setTag('money_path', path)
        scope.setTag('money', 'true')
      }
      scope.setContext('fields', rest)
      if (err instanceof Error) Sentry.captureException(err)
      else Sentry.captureMessage(`${event}: ${message}`, 'error')
    })
  },
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}
