import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseAmountToCents, verifyPaymentAmount } from '@/lib/payments'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import { resolvePayfastConfig, type PayfastConfig } from '@/lib/payfast/config'
import { isFromPayfastLive } from '@/lib/payfast/ips'
import { grantBetForPayment } from '@/lib/claims/grant'

/** How long we give PayFast's validate endpoint before failing closed. */
const VALIDATE_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------
// Step 1 helper — verify MD5 signature (over the fields as posted, in order)
// ---------------------------------------------------------------------------
function verifySignature(data: Record<string, string>, passphrase: string): boolean {
  const { signature, ...rest } = data
  const qs = Object.entries(rest)
    .map(([k, v]) => `${k}=${encodeURIComponent(v.trim()).replace(/%20/g, '+')}`)
    .join('&')
  const toHash = passphrase
    ? `${qs}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`
    : qs
  const computed = crypto.createHash('md5').update(toHash).digest('hex')
  return typeof signature === 'string' && computed === signature
}

// ---------------------------------------------------------------------------
// Step 2 helper — "phone home" to PayFast's validate endpoint
// ---------------------------------------------------------------------------
async function validateWithPayFast(validateUrl: string, rawBody: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS)
  try {
    const res = await fetch(validateUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    rawBody,
      signal:  controller.signal,
    })
    const text = await res.text()
    return text.trim().toUpperCase() === 'VALID'
  } catch (err) {
    // Fail closed on timeout or network issues — reject the ITN; PayFast will retry
    log.error('payfast.itn.validate_unreachable', err, { path: 'payfast_itn', timeout_ms: VALIDATE_TIMEOUT_MS })
    return false
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// POST /api/payments/payfast/notify  ← PayFast calls this, not your browser
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const cfg = resolvePayfastConfig()
  if (!cfg.ok) {
    await alertOps({ event: 'payfast.itn.misconfigured', path: 'payfast_itn', summary: `ITN refused: ${cfg.reason}. PayFast will retry.` })
    return new NextResponse('Payments misconfigured', { status: 503 })
  }
  const config: PayfastConfig = cfg.config

  try {
    const rawBody = await request.text()
    const params  = Object.fromEntries(new URLSearchParams(rawBody))

    // ── 1. IP allow-list (live mode only — sandbox IPs vary) ───────────────
    if (!config.sandbox) {
      const forwardedFor = request.headers.get('x-forwarded-for') ?? ''
      const realIp = request.headers.get('x-real-ip') ?? ''
      const allIps = [...forwardedFor.split(',').map(ip => ip.trim()), realIp.trim()].filter(Boolean)
      if (!(await isFromPayfastLive(allIps))) {
        log.warn('payfast.itn.rejected_ip', { ips: allIps })
        return new NextResponse('Forbidden', { status: 403 })
      }
    }

    // ── 2. Signature verification ─────────────────────────────────────────
    if (!verifySignature(params, config.passphrase)) {
      log.warn('payfast.itn.invalid_signature', { m_payment_id: params.m_payment_id ?? null, pf_payment_id: params.pf_payment_id ?? null })
      return new NextResponse('Invalid signature', { status: 400 })
    }

    // ── 3. Phone home — ask PayFast if this ITN is genuine ────────────────
    const pfValid = await validateWithPayFast(config.validateUrl, rawBody)
    if (!pfValid) {
      log.warn('payfast.itn.validate_invalid', { m_payment_id: params.m_payment_id ?? null, pf_payment_id: params.pf_payment_id ?? null })
      return new NextResponse('Validation failed', { status: 400 })
    }

    // ── 4. Merchant ID check ──────────────────────────────────────────────
    if (params.merchant_id !== config.merchantId) {
      log.warn('payfast.itn.merchant_mismatch', { merchant_id: params.merchant_id ?? null, m_payment_id: params.m_payment_id ?? null })
      return new NextResponse('Merchant mismatch', { status: 400 })
    }

    log.info('payfast.itn.received', {
      payment_status: params.payment_status ?? null,
      m_payment_id: params.m_payment_id ?? null,
      pf_payment_id: params.pf_payment_id ?? null,
      amount_gross: params.amount_gross ?? null,
    })

    // Only COMPLETE payments touch the ledger
    if (params.payment_status !== 'COMPLETE') {
      return new NextResponse('OK', { status: 200 })
    }

    // ── 5. Verify the amount matches the tier we sold ─────────────────────
    const mPaymentId  = (params.m_payment_id  ?? '').trim()
    const pfPaymentId = (params.pf_payment_id ?? '').trim()
    const tier        = (params.custom_str4   ?? '').trim()
    const userId      = (params.custom_str1   ?? '').trim()
    const courseId    = (params.custom_str2   ?? '').trim()
    const holeId      = (params.custom_str3   ?? '').trim()

    const amountCents = parseAmountToCents(params.amount_gross)
    const check       = verifyPaymentAmount(tier, amountCents)
    if (!check.ok) {
      await alertOps({
        event: `payfast.itn.${check.reason}`,
        path: 'payfast_itn',
        summary: `Payment ${mPaymentId} paid ${amountCents}c against tier ${tier || '(none)'} (expected ${check.expectedCents ?? 'unknown'}c). No bet granted; ledger row marked amount_mismatch.`,
        details: { m_payment_id: mPaymentId, pf_payment_id: pfPaymentId, user_id: userId, tier, amount_cents: amountCents, expected_cents: check.expectedCents },
      })
    }

    if (!mPaymentId) {
      await alertOps({ event: 'payfast.itn.missing_reference', path: 'payfast_itn', summary: 'COMPLETE payment arrived with no m_payment_id; it cannot be matched to a checkout.', details: { pf_payment_id: pfPaymentId, user_id: userId, amount_cents: amountCents } })
      return new NextResponse('OK', { status: 200 })
    }

    let supabase
    try {
      supabase = createAdminClient()
    } catch (dbErr) {
      await alertOps({ event: 'payfast.itn.admin_client_unavailable', path: 'payfast_itn', summary: 'The ITN could not open a service-role client (SUPABASE_SERVICE_ROLE_KEY missing?). No payments can be recorded.', details: { m_payment_id: mPaymentId }, err: dbErr })
      return new NextResponse('Ledger write failed', { status: 500 })
    }

    // ── 6. Record the payment. This ledger is what /api/bets/create checks;
    // until a row lands here, no bet exists for this payment. A repeated ITN
    // for the same transaction is a no-op. A row that already exists (a
    // charge against a saved card writes its own row, with the right hole,
    // before asking PayFast) keeps its user, course, hole and tier: an ITN
    // for a token charge echoes the FIRST payment's custom fields, which
    // would otherwise attach this payment to the wrong hole.
    const { data: existingRow } = await supabase
      .from('payfast_payments')
      .select('m_payment_id, status, tier')
      .eq('m_payment_id', mPaymentId)
      .maybeSingle()
    let payErr: { message: string } | null = null
    if (existingRow) {
      const rowCheck = verifyPaymentAmount(existingRow.tier ?? '', amountCents)
      const nextStatus = existingRow.status === 'complete' ? 'complete' : rowCheck.ok ? 'complete' : 'amount_mismatch'
      const { error } = await supabase
        .from('payfast_payments')
        .update({ pf_payment_id: pfPaymentId || null, status: nextStatus, raw_payload: params })
        .eq('m_payment_id', mPaymentId)
      payErr = error
    } else {
      const { error } = await supabase
        .from('payfast_payments')
        .insert({
          m_payment_id:  mPaymentId,
          pf_payment_id: pfPaymentId || null,
          user_id:       userId   || null,
          course_id:     courseId || null,
          hole_id:       holeId   || null,
          tier:          check.ok ? check.tier : null,
          amount_cents:  amountCents,
          status:        check.ok ? 'complete' : 'amount_mismatch',
          raw_payload:   params,
        })
      payErr = error
    }

    if (payErr) {
      await alertOps({
        event: 'payfast.itn.ledger_write_failed',
        path: 'payfast_itn',
        summary: `Could not record payment ${mPaymentId}. The payer has paid and cannot get a bet until this is fixed. PayFast will retry.`,
        details: { m_payment_id: mPaymentId, pf_payment_id: pfPaymentId, user_id: userId, amount_cents: amountCents, hint: 'If the error says relation "payfast_payments" does not exist, migration 005 is not applied.' },
        err: payErr,
      })
      return new NextResponse('Ledger write failed', { status: 500 })
    }

    log.info('payfast.itn.recorded', { m_payment_id: mPaymentId, pf_payment_id: pfPaymentId, user_id: userId, tier, amount_cents: amountCents, status: check.ok ? 'complete' : 'amount_mismatch', existing: !!existingRow })

    // ── 6b. A saved card: the golfer ticked "save my card" at checkout
    // (subscription_type=2) and PayFast returned the token. Keep it so the
    // next entry is one tap. The card itself never reaches us.
    const token = (params.token ?? '').trim()
    if (token && userId) {
      const { error: cardErr } = await supabase
        .from('payment_cards')
        .upsert({ user_id: userId, token, last_used_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (cardErr) log.warn('payfast.itn.card_save_failed', { user_id: userId, error: cardErr.message })
      else log.info('payfast.itn.card_saved', { user_id: userId })
    }

    // ── 7. Grant the bet now, so it exists whether or not the golfer's
    // browser comes back with a session (an installed iOS app returns from
    // PayFast in an in-app browser with no cookies). A repeat ITN finds the
    // bet it already made. Never fail the ITN over this: the ledger row is
    // written, and the return page or Home can finish what is left (an
    // unverified age, for instance).
    if (check.ok || existingRow) {
      try {
        const granted = await grantBetForPayment(supabase, mPaymentId, { source: 'itn', createdIpHash: null })
        if (!granted.ok) log.info('payfast.itn.bet_not_granted', { m_payment_id: mPaymentId, user_id: userId, reason: granted.reason })
      } catch (grantErr) {
        await alertOps({ event: 'payfast.itn.grant_failed', path: 'payfast_itn', summary: `Payment ${mPaymentId} is recorded but the bet could not be granted from the ITN; the return page or Home will retry.`, details: { m_payment_id: mPaymentId, user_id: userId }, err: grantErr })
      }
    }

    // ── 8. If a bet already existed for this reference, attach PayFast's id
    // for reconciliation. The bet's own reference (payment_intent_id) is
    // never rewritten, so /api/bets/create can always find it. Status is
    // never touched: a late ITN must not reset a resolved result.
    if (pfPaymentId) {
      const { error: betErr } = await supabase
        .from('bets')
        .update({ pf_payment_id: pfPaymentId })
        .eq('payment_intent_id', mPaymentId)
        .is('pf_payment_id', null)
      if (betErr) log.warn('payfast.itn.reference_link_failed', { m_payment_id: mPaymentId, pf_payment_id: pfPaymentId, error: betErr.message })
    }

    return new NextResponse('OK', { status: 200 })
  } catch (err) {
    // Unexpected failure after PayFast has told us about real money: say so
    // (500) so PayFast retries, rather than acknowledging and losing it.
    await alertOps({ event: 'payfast.itn.unhandled', path: 'payfast_itn', summary: 'Unhandled error in the ITN handler; answered 500 so PayFast retries.', err })
    return new NextResponse('Internal error', { status: 500 })
  }
}
