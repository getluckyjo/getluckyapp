import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkHealth, type HealthReport } from '@/lib/health'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { log } from '@/lib/observability/log'

/**
 * GET /api/health — public, for an uptime monitor.
 *
 * 200 `{ ok: true, db: 'ok', outbox: 'ok' | 'idle', outboxBacklog, lastDrainAt }`
 * when the database answers and no outbox job is more than ten minutes
 * overdue; 503 `{ ok: false, … }` with the failing part named in `failing`
 * otherwise. Never cached, never carries an error message: the reason is in
 * the log and in Sentry under `health.*`.
 *
 * Rate limited per IP (60 in ten minutes) so the endpoint cannot be used to
 * hammer the database; a monitor polls once a minute.
 */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET(request: Request) {
  const limited = await enforceRateLimit(RULES.health, { ip: clientIp(request) })
  if (limited) return limited

  let report: HealthReport
  try {
    report = await checkHealth(createAdminClient())
  } catch (err) {
    // The client could not be made or a read threw: the database part is down.
    log.error('health.check_failed', err)
    report = { ok: false, db: 'error', outbox: 'error', outboxBacklog: null, lastDrainAt: null, failing: ['db', 'outbox'], checkedAt: new Date().toISOString() }
  }
  return NextResponse.json(report, { status: report.ok ? 200 : 503, headers: NO_STORE })
}
