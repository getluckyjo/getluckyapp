import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveStitchConfig } from '@/lib/stitch/config'
import { amountToCents } from '@/lib/stitch/api'
import { parseTransactionEvent, verifySvixSignature } from '@/lib/stitch/webhook'
import { settleStitchTransaction } from '@/lib/stitch/settle'
import { log } from '@/lib/observability/log'

export const dynamic = 'force-dynamic'

/**
 * POST /api/payments/stitch/webhook — Stitch's word on a transaction.
 *
 * Stitch delivers webhooks through Svix, signed with the subscription's
 * secret. Unsigned, badly signed or stale (over five minutes) requests
 * are 401 and nothing is read from them. Every event id is remembered
 * (stitch_webhook_events), so a redelivery is a 200 that does nothing.
 *
 * Only `transaction` events with one of our gl_ references are acted on:
 *   SUCCESS              → the ledger row is 'complete' and the bet granted
 *                          (a no-op when the charge route already did it);
 *   FAILURE / CANCELLED  → a row still pending or unknown is 'failed';
 *   PENDING, anything else → noted, nothing written.
 * A SUCCESS whose amount is not the tier's is 'amount_mismatch' with an
 * ops alert, never a bet. Everything is conditional on the row's current
 * status, so the charge route, this webhook and the cron cannot overwrite
 * each other's answer.
 */
export async function POST(request: NextRequest) {
  const cfg = resolveStitchConfig()
  const secret = cfg.ok ? cfg.config.webhookSecret : null
  if (!secret) {
    log.warn('stitch.webhook.unconfigured', { reason: cfg.ok ? 'no webhook secret' : cfg.reason })
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const raw = await request.text()
  const verdict = verifySvixSignature(secret, {
    'svix-id': request.headers.get('svix-id'),
    'svix-timestamp': request.headers.get('svix-timestamp'),
    'svix-signature': request.headers.get('svix-signature'),
  }, raw)
  if (!verdict.ok) {
    log.warn('stitch.webhook.rejected', { reason: verdict.reason })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const admin = createAdminClient()
  const type = body && typeof body === 'object' && typeof (body as { type?: unknown }).type === 'string' ? (body as { type: string }).type : 'unknown'
  const event = parseTransactionEvent(body)

  // Remember the delivery first; a duplicate id is a redelivery and stops here.
  const { error: dedupeErr } = await admin.from('stitch_webhook_events').insert({
    id: verdict.id,
    event_type: type,
    reference: event?.data.externalReference ?? null,
    status: event?.data.status ?? null,
  })
  if (dedupeErr) {
    if (dedupeErr.code === '23505') {
      log.info('stitch.webhook.duplicate', { svix_id: verdict.id, type })
      return NextResponse.json({ ok: true, duplicate: true })
    }
    // Could not record it: say so and let Svix retry, rather than act twice.
    log.error('stitch.webhook.dedupe_write_failed', dedupeErr, { path: 'payfast_itn', svix_id: verdict.id })
    return NextResponse.json({ error: 'Try again' }, { status: 500 })
  }

  if (!event) {
    log.info('stitch.webhook.ignored', { svix_id: verdict.id, type })
    return NextResponse.json({ ok: true, ignored: true })
  }
  const reference = event.data.externalReference ?? ''
  if (!reference.startsWith('gl_')) {
    log.info('stitch.webhook.not_ours', { svix_id: verdict.id, stitch_id: event.data.id, reference: reference || null })
    return NextResponse.json({ ok: true, ignored: true })
  }

  const settled = await settleStitchTransaction(admin, {
    reference,
    stitchId: event.data.id,
    status: event.data.status,
    reason: event.data.statusReason ?? null,
    amountCents: amountToCents(event.data.amount),
    source: 'webhook',
  })
  log.info('stitch.webhook.processed', { svix_id: verdict.id, reference, stitch_id: event.data.id, status: event.data.status, result: settled })
  return NextResponse.json({ ok: true, result: settled })
}
