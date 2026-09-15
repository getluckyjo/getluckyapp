import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import { apiError } from '@/lib/api/http'
import { runRetention } from '@/lib/retention'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/retention — the nightly purge (vercel.json schedules it).
 *
 * Vercel calls it with `Authorization: Bearer $CRON_SECRET`. Without the
 * secret configured the route refuses to run at all rather than run for
 * anyone who finds the URL.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    log.error('retention.misconfigured', 'CRON_SECRET is not set; the retention sweep did not run')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runRetention(createAdminClient())
    if (result.errors > 0) {
      await alertOps({
        event: 'retention.partial_failure',
        path: 'claim',
        summary: `${result.errors} row(s) could not be purged tonight; they will be retried tomorrow. See retention.*_failed logs.`,
        details: { ...result },
      })
    }
    return NextResponse.json(result)
  } catch (err) {
    return apiError('retention.unhandled', err, { path: 'claim' })
  }
}

function bearerMatches(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(header ?? '')
  return given.length === expected.length && timingSafeEqual(given, expected)
}
