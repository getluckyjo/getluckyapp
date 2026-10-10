import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api/http'
import { requireCron } from '@/lib/cron-auth'
import { resolvePayfastConfig } from '@/lib/payfast/config'
import { reconcileMissingPayments } from '@/lib/payfast/reconcile'

export const dynamic = 'force-dynamic'
export const maxDuration = 55

/**
 * GET /api/cron/reconcile — the ledger against PayFast's history, every ten
 * minutes (vercel.json). A payment whose ITN never arrived gets its ledger
 * row and its bet here; see reconcileMissingPayments. Idempotent: a row
 * that exists is left alone, and the insert is keyed on the reference.
 */
export async function GET(request: NextRequest) {
  const refused = requireCron(request, 'reconcile')
  if (refused) return refused
  const cfg = resolvePayfastConfig()
  if (!cfg.ok) return NextResponse.json({ skipped: 'payfast_misconfigured' })
  try {
    const result = await reconcileMissingPayments(createAdminClient(), cfg.config)
    return NextResponse.json(result)
  } catch (err) {
    return apiError('payfast.sweep.unhandled', err, { path: 'payfast_itn' })
  }
}
