import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { alertOps } from '@/lib/observability/alerts'
import { apiError } from '@/lib/api/http'
import { requireCron } from '@/lib/cron-auth'
import { runRetention } from '@/lib/retention'
import { closeClaimsWithoutFootage } from '@/lib/claims/triage'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/retention — the nightly purge (vercel.json schedules it),
 * then the claims nobody can review (src/lib/claims/triage.ts). Each has
 * its own result; a failure in one does not stop the other.
 *
 * Vercel calls it with `Authorization: Bearer $CRON_SECRET`. Without the
 * secret configured the route refuses to run at all rather than run for
 * anyone who finds the URL.
 */
export async function GET(request: NextRequest) {
  const refused = requireCron(request, 'retention')
  if (refused) return refused

  try {
    const admin = createAdminClient()
    const result = await runRetention(admin)
    if (result.errors > 0) {
      await alertOps({
        event: 'retention.partial_failure',
        path: 'claim',
        summary: `${result.errors} row(s) could not be purged tonight; they will be retried tomorrow. See retention.*_failed logs.`,
        details: { ...result },
      })
    }
    let triage
    try {
      triage = await closeClaimsWithoutFootage(admin)
    } catch (err) {
      await alertOps({ event: 'claim.triage_failed', path: 'claim', summary: 'The nightly close of claims without footage did not run; they stay in the queue.', err })
      triage = { error: true }
    }
    return NextResponse.json({ ...result, triage })
  } catch (err) {
    return apiError('retention.unhandled', err, { path: 'claim' })
  }
}
