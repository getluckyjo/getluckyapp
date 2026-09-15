import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api/http'
import { requireCron } from '@/lib/cron-auth'
import { drainOutbox } from '@/lib/outbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 55

/** GET /api/cron/outbox — drain due background jobs (vercel.json: every minute). */
export async function GET(request: NextRequest) {
  const refused = requireCron(request, 'outbox')
  if (refused) return refused
  try {
    return NextResponse.json(await drainOutbox(createAdminClient()))
  } catch (err) {
    return apiError('outbox.unhandled', err, { path: 'claim' })
  }
}
