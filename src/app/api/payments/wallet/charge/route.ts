import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { claimErrorResponse } from '@/lib/claims/state-machine'
import { assertProfileNotSuspended, gatePlayRequest } from '@/lib/api/gate'
import { grantBetForPayment } from '@/lib/claims/grant'
import { resolveStitchConfig } from '@/lib/stitch/config'
import { initiateWalletTransaction, type WalletKind } from '@/lib/stitch/api'
import { checkTarget } from '@/lib/payfast/target'
import { BET_TIERS } from '@/lib/tiers'
import { RULES, clientIp } from '@/lib/rate-limit'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { hashIdentifier } from '@/lib/risk/hash'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import type { Json } from '@/types/database'
import { findByIdempotencyKey, isIdempotencyConflict, readIdempotencyKey, replayCharge } from '@/lib/payments/idempotency'

const Body = z.object({
  tier: z.enum(BET_TIERS.map(t => t.tier) as [string, ...string[]]),
  courseId: uuid,
  holeId: uuid,
  wallet: z.enum(['apple_pay', 'google_pay']),
  /** The wallet's payment token, base64, as the Stitch client SDK hands it over. Never logged. */
  token: z.string().min(1).max(20_000),
  /** The SDK's device fingerprint, base64. */
  fingerprint: z.string().max(10_000).nullable().optional(),
  /** What the wallet said about the card: network and a display name. Nothing sensitive. */
  card: z.object({
    network: z.string().max(40).nullable().optional(),
    displayName: z.string().max(80).nullable().optional(),
    type: z.string().max(20).nullable().optional(),
  }).optional(),
})

/**
 * POST /api/payments/wallet/charge — pay with Apple Pay or Google Pay,
 * through Stitch, in one call.
 * Body: { tier, courseId, holeId, wallet, token, fingerprint?, card? }.
 *
 * The wallet sheet ran on our own page: the golfer confirmed the amount
 * with Face ID or their Google account and the browser gave us a token
 * only Stitch can decrypt. Same gates as every other payment (session,
 * not suspended, rate limit, the hole rule, an open course); the amount
 * comes from the tier, and the sheet showed that same tier amount, so a
 * token for any other amount is refused by Stitch. The ledger row is
 * written first, as 'pending' with provider 'stitch', so the webhook
 * can only ever attach the money to the hole the golfer chose.
 *
 *   success          → row 'complete', bet granted here: { betId, m_payment_id }
 *   failure          → row 'failed', 402 WALLET_DECLINED, no bet
 *   pending with an interaction URL (3-D Secure on a Google Pay card)
 *                    → row stays 'pending', 202 THREE_DS with the URL;
 *                      the webhook completes it, Home shows it confirming
 *   no answer at all → row 'unknown', 409 CHARGE_UNKNOWN; the webhook or
 *                      the reconciliation cron settles it. Never 'failed'.
 */
export async function POST(request: NextRequest) {
  try {
    const cfg = resolveStitchConfig()
    if (!cfg.ok) {
      await alertOps({ event: 'stitch.charge.misconfigured', path: 'payfast_checkout', summary: `Wallet charge refused: ${cfg.reason}` })
      return NextResponse.json({ error: 'Apple Pay and Google Pay are not available right now.', code: 'WALLET_UNAVAILABLE' }, { status: 503 })
    }
    const config = cfg.config

    const gate = await gatePlayRequest(request, RULES.checkout)
    if (!gate.ok) return gate.response
    const { user, supabase, profile } = gate
    assertProfileNotSuspended(profile)

    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { tier, courseId, holeId, wallet, token, fingerprint, card } = body.data
    const tierData = BET_TIERS.find(t => t.tier === tier)!

    const refused = await checkTarget(supabase, courseId, holeId)
    if (refused) return refused

    const admin = createAdminClient()
    const mPaymentId = `gl_${randomUUID()}`
    const amountCents = tierData.stakeZAR * 100
    const walletKind: WalletKind = wallet

    // A retry after a lost answer, or a second tap: the first row answers.
    const idem = readIdempotencyKey(request)
    if (idem.response) return idem.response
    const declined = 'The payment was not approved. Pay another way below.'
    if (idem.key) {
      const earlier = await findByIdempotencyKey(admin, user.id, idem.key)
      if (earlier) return replayCharge(admin, earlier, { userId: user.id, createdIpHash: hashIdentifier('ip', clientIp(request)), declined })
    }

    const { error: ledgerErr } = await admin.from('payfast_payments').insert({
      m_payment_id: mPaymentId,
      user_id: user.id,
      course_id: courseId,
      hole_id: holeId,
      tier: tierData.tier,
      amount_cents: amountCents,
      status: 'pending',
      provider: 'stitch',
      ...(idem.key ? { idempotency_key: idem.key } : {}),
      raw_payload: { source: 'wallet', wallet: walletKind } as Json,
    })
    if (isIdempotencyConflict(ledgerErr) && idem.key) {
      // A duplicate raced past the lookup: the first row answers.
      const earlier = await findByIdempotencyKey(admin, user.id, idem.key)
      if (earlier) return replayCharge(admin, earlier, { userId: user.id, createdIpHash: hashIdentifier('ip', clientIp(request)), declined })
    }
    if (ledgerErr) {
      await alertOps({ event: 'stitch.charge.ledger_write_failed', path: 'payfast_checkout', summary: 'Could not write the pending ledger row before a wallet charge; nothing was charged.', details: { user_id: user.id, m_payment_id: mPaymentId }, err: ledgerErr })
      return apiError('stitch.charge.ledger_write_failed', ledgerErr, { path: 'payfast_checkout', message: 'Could not start the payment. Please try again.' })
    }

    let outcome
    try {
      outcome = await initiateWalletTransaction(config, {
        wallet: walletKind,
        token,
        fingerprint: fingerprint ?? null,
        amountCents,
        reference: mPaymentId,
        nonce: randomUUID(),
        payer: { id: user.id, email: user.email ?? null, name: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null, ip: clientIp(request) || null, createdAt: user.created_at ?? null },
        meta: card ? { network: card.network ?? null, displayName: card.displayName ?? null, type: card.type ?? null } : undefined,
      })
    } catch (err) {
      // No usable answer: Stitch may have charged. Never 'failed' here; only
      // a row still 'pending' is marked, so a webhook that beat us wins.
      const detail = err instanceof Error ? err.message : String(err)
      const { error: unknownErr } = await admin
        .from('payfast_payments')
        .update({ status: 'unknown', raw_payload: { source: 'wallet', wallet: walletKind, error: detail } })
        .eq('m_payment_id', mPaymentId)
        .eq('status', 'pending')
      if (unknownErr) {
        await alertOps({ event: 'stitch.charge.unknown_write_failed', path: 'payfast_checkout', summary: `Wallet charge ${mPaymentId} got no answer from Stitch and the ledger row could not be marked unknown; it is still pending.`, details: { user_id: user.id, m_payment_id: mPaymentId }, err: unknownErr })
      }
      log.warn('stitch.charge.unknown', { user_id: user.id, m_payment_id: mPaymentId, wallet: walletKind, error: detail })
      return NextResponse.json(
        { error: 'We could not confirm the payment. Check your shots in a minute before paying again.', code: 'CHARGE_UNKNOWN', m_payment_id: mPaymentId },
        { status: 409 },
      )
    }

    if (outcome.state === 'failure') {
      await admin.from('payfast_payments').update({ status: 'failed', provider_ref: outcome.id, raw_payload: { source: 'wallet', wallet: walletKind, reason: outcome.reason, description: outcome.description } }).eq('m_payment_id', mPaymentId).eq('status', 'pending')
      log.warn('stitch.charge.declined', { user_id: user.id, m_payment_id: mPaymentId, wallet: walletKind, reason: outcome.reason, description: outcome.description })
      return NextResponse.json(
        { error: outcome.description ? `The payment was not approved: ${outcome.description}` : 'The payment was not approved. Pay another way below.', code: 'WALLET_DECLINED' },
        { status: 402 },
      )
    }

    if (outcome.state === 'pending') {
      // The bank wants a 3-D Secure step (a Google Pay card, usually).
      // Hand the page the URL; the webhook writes the outcome.
      await admin.from('payfast_payments').update({ provider_ref: outcome.id, raw_payload: { source: 'wallet', wallet: walletKind, pending: outcome.reason, three_ds: !!outcome.interactionUrl } }).eq('m_payment_id', mPaymentId).eq('status', 'pending')
      log.info('stitch.charge.pending', { user_id: user.id, m_payment_id: mPaymentId, wallet: walletKind, reason: outcome.reason, three_ds: !!outcome.interactionUrl })
      return NextResponse.json(
        { code: outcome.interactionUrl ? 'THREE_DS' : 'PAYMENT_PENDING', m_payment_id: mPaymentId, interactionUrl: outcome.interactionUrl },
        { status: 202 },
      )
    }

    const { error: completeErr } = await admin
      .from('payfast_payments')
      .update({ status: 'complete', provider_ref: outcome.id, raw_payload: { source: 'wallet', wallet: walletKind, stitch_id: outcome.id } })
      .eq('m_payment_id', mPaymentId)
    if (completeErr) {
      await alertOps({ event: 'stitch.charge.complete_write_failed', path: 'payfast_checkout', summary: `Wallet charge ${mPaymentId} succeeded at Stitch but the ledger could not be marked complete; the webhook will. Watch for the bet.`, details: { user_id: user.id, m_payment_id: mPaymentId }, err: completeErr })
    }

    const granted = await grantBetForPayment(admin, mPaymentId, { source: 'return', createdIpHash: hashIdentifier('ip', clientIp(request)) })
    if (!granted.ok) {
      log.warn('stitch.charge.bet_not_granted', { user_id: user.id, m_payment_id: mPaymentId, reason: granted.reason })
      return NextResponse.json({ error: 'Paid, but your shot could not be set up yet.', code: granted.reason, m_payment_id: mPaymentId }, { status: 409 })
    }

    log.info('stitch.charge.completed', { user_id: user.id, m_payment_id: mPaymentId, bet_id: granted.betId, wallet: walletKind, tier: tierData.tier, amount_cents: amountCents })
    return NextResponse.json({ betId: granted.betId, m_payment_id: mPaymentId })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('stitch.charge.failed', err, { path: 'payfast_checkout', message: 'The payment could not be completed. Please try again.' })
  }
}
