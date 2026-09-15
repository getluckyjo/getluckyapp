/**
 * Vercel calls cron routes with `Authorization: Bearer $CRON_SECRET`.
 * Without the secret configured a cron route refuses to run at all rather
 * than run for anyone who finds the URL.
 */
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { log } from '@/lib/observability/log'

export function requireCron(request: Request, name: string): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    log.error(`${name}.misconfigured`, `CRON_SECRET is not set; ${name} did not run`)
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  const expected = Buffer.from(`Bearer ${secret}`)
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
