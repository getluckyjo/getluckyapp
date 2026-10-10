import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api/http'
import { requireCron } from '@/lib/cron-auth'
import { drainOutbox } from '@/lib/outbox'
import { resolvePayfastConfig } from '@/lib/payfast/config'
import { reconcileUnknownPayments, type ReconcileResult } from '@/lib/payfast/reconcile'
import { log } from '@/lib/observability/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 55

/**
 * GET /api/cron/outbox — drain due background jobs (vercel.json: every
 * minute), then settle saved-card charges PayFast never answered for
 * (src/lib/payfast/reconcile.ts). The reconciliation rides on this cron so
 * it runs every minute without another entry; it is idempotent and fails
 * safe (a row stays 'unknown' until PayFast can be asked), and it never
 * fails the drain: its own error is logged and the drain's result returned.
 */
export async function GET(request: NextRequest) {
  const refused = requireCron(request, 'outbox')
  if (refused) return refused
  try {
    const admin = createAdminClient()
    const drained = await drainOutbox(admin)
    let reconcile: ReconcileResult | { skipped: string } | { error: true }
    const cfg = resolvePayfastConfig()
    if (!cfg.ok) {
      reconcile = { skipped: 'payfast_misconfigured' }
    } else {
      try {
        reconcile = await reconcileUnknownPayments(admin, cfg.config)
      } catch (err) {
        log.error('payfast.reconcile.unhandled', err, { path: 'payfast_checkout' })
        reconcile = { error: true }
      }
    }
    return NextResponse.json({ ...drained, reconcile })
  } catch (err) {
    return apiError('outbox.unhandled', err, { path: 'claim' })
  }
}
