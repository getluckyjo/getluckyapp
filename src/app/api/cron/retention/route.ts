import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { alertOps } from '@/lib/observability/alerts'
import { apiError } from '@/lib/api/http'
import { requireCron } from '@/lib/cron-auth'
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
  const refused = requireCron(request, 'retention')
  if (refused) return refused

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
