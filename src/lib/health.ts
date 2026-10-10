/**
 * What /api/health reports: can the database be reached, and is the outbox
 * being drained. Three cheap reads through the service role:
 *
 *   db        one row from a small table.
 *   backlog   jobs that were due more than BACKLOG_MINUTES ago and are
 *             neither done nor dead. The cron runs every minute, so a job
 *             that has waited ten is a cron that is not running (or a
 *             handler that keeps failing fast).
 *   drain     the latest done_at within the last hour, or "idle" when
 *             nothing was drained in that time, which is not a failure:
 *             on a quiet night there is nothing to drain.
 *
 * Nothing here says why: a failing part is named, the error goes to the
 * log and to Sentry, and the response carries no internal text.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { log } from '@/lib/observability/log'

export const BACKLOG_MINUTES = 10
export const DRAIN_WINDOW_MINUTES = 60

export interface HealthReport {
  ok: boolean
  db: 'ok' | 'error'
  outbox: 'ok' | 'idle' | 'backlog' | 'error'
  /** Jobs overdue by BACKLOG_MINUTES or more; null when the outbox could not be read. */
  outboxBacklog: number | null
  /** The latest completed job in the last hour; null when there was none (idle) or the outbox could not be read. */
  lastDrainAt: string | null
  /** The parts that failed, so a monitor can say which. */
  failing: ('db' | 'outbox')[]
  checkedAt: string
}

type Admin = SupabaseClient<Database>

export async function checkHealth(admin: Admin, now: Date = new Date()): Promise<HealthReport> {
  const backlogBefore = new Date(now.getTime() - BACKLOG_MINUTES * 60_000).toISOString()
  const drainAfter = new Date(now.getTime() - DRAIN_WINDOW_MINUTES * 60_000).toISOString()

  const [db, backlog, drain] = await Promise.all([
    admin.from('courses').select('id').limit(1),
    admin.from('outbox').select('id', { count: 'exact', head: true })
      .is('done_at', null).is('failed_at', null).lt('next_attempt_at', backlogBefore),
    admin.from('outbox').select('done_at')
      .not('done_at', 'is', null).gte('done_at', drainAfter)
      .order('done_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const report: HealthReport = { ok: true, db: 'ok', outbox: 'ok', outboxBacklog: null, lastDrainAt: null, failing: [], checkedAt: now.toISOString() }

  if (db.error) {
    log.error('health.db_unreachable', db.error)
    report.db = 'error'
    report.failing.push('db')
  }

  if (backlog.error || drain.error) {
    log.error('health.outbox_unreadable', backlog.error ?? drain.error)
    report.outbox = 'error'
    report.failing.push('outbox')
  } else {
    report.outboxBacklog = backlog.count ?? 0
    report.lastDrainAt = (drain.data?.done_at as string | null | undefined) ?? null
    if (report.outboxBacklog > 0) {
      log.warn('health.outbox_backlog', { backlog: report.outboxBacklog, last_drain_at: report.lastDrainAt })
      report.outbox = 'backlog'
      report.failing.push('outbox')
    } else if (!report.lastDrainAt) {
      report.outbox = 'idle'
    }
  }

  report.ok = report.failing.length === 0
  return report
}
