import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { assertNotSuspended, claimErrorResponse } from '@/lib/claims/state-machine'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import { resolvePayfastConfig } from '@/lib/payfast/config'
import { BET_TIERS } from '@/lib/tiers'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { checkTarget } from '@/lib/payfast/target'

// ---------------------------------------------------------------------------
// PayFast-mandated parameter order for signature generation
// Ref: https://developers.payfast.co.za/docs#step_2_signature
// ---------------------------------------------------------------------------
const PF_FIELD_ORDER = [
  'merchant_id', 'merchant_key', 'return_url', 'cancel_url', 'notify_url',
  'name_first', 'name_last', 'email_address', 'cell_number',
  'm_payment_id', 'amount', 'item_name', 'item_description',
  'custom_int1', 'custom_int2', 'custom_int3', 'custom_int4', 'custom_int5',
  'custom_str1', 'custom_str2', 'custom_str3', 'custom_str4', 'custom_str5',
  'email_confirmation', 'confirmation_address', 'currency', 'payment_method',
  'subscription_type', 'billing_date', 'recurring_amount', 'frequency', 'cycles',
  'subscription_notify_email', 'subscription_notify_webhook', 'subscription_notify_buyer',
]

/** URL-encode a value per PayFast's published sample: spaces → +, trimmed. */
function pfEncode(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%20/g, '+')
}

function generateSignature(data: Record<string, string>, passphrase: string): string {
  const parts: string[] = []
  for (const key of PF_FIELD_ORDER) {
    if (data[key] !== undefined && data[key] !== '') {
      parts.push(`${key}=${pfEncode(data[key])}`)
    }
  }
  const paramString = parts.join('&')
  const sigInput = passphrase ? `${paramString}&passphrase=${pfEncode(passphrase)}` : paramString
  return crypto.createHash('md5').update(sigInput).digest('hex')
}

/** The signed fields as PayFast's sample builds them, signature last. */
function pfParamString(data: Record<string, string>, signature: string): string {
  const parts: string[] = []
  for (const key of PF_FIELD_ORDER) {
    if (data[key] !== undefined && data[key] !== '') parts.push(`${key}=${pfEncode(data[key])}`)
  }
  parts.push(`signature=${signature}`)
  return parts.join('&')
}

/**
 * The origin the golfer is on, so PayFast sends them back to the same host:
 * a session cookie set on www.getluckyholeinone.com is not sent to the
 * .vercel.app alias, and a return there looks signed out. Only our own hosts
 * qualify (the Host header is set by Vercel's routing, but a stranger's value
 * must never become a redirect target); anything else falls back to the
 * configured site URL.
 */
function returnOrigin(request: NextRequest, fallback: string): string {
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').split(',')[0].trim().toLowerCase()
  if (!host) return fallback
  const ours = /(^|\.)getluckyholeinone\.com$|\.vercel\.app$|^localhost(:\d+)?$/.test(host)
  if (!ours) return fallback
  const proto = (request.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')).split(',')[0].trim()
  return `${proto}://${host}`
}

/**
 * PayFast Onsite Payments: exchange the signed fields for a payment
 * identifier, and the client opens PayFast's modal on our page instead of
 * leaving for the hosted checkout. Nobody leaves the app, so the session
 * (and an installed iOS app's isolated storage) is never lost on the way
 * back. Any failure here means the hosted page as before, not a failed
 * checkout. PAYFAST_ONSITE=off disables it without a deploy.
 */
async function onsiteIdentifier(
  config: { onsiteProcessUrl: string; onsiteEngineUrl: string },
  paramString: string,
  mPaymentId: string,
): Promise<{ uuid: string; engineUrl: string } | null> {
  if ((process.env.PAYFAST_ONSITE ?? 'on').trim().toLowerCase() === 'off') return null
  try {
    const res = await fetch(config.onsiteProcessUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: paramString,
      signal: AbortSignal.timeout(4000),
    })
    const json = (await res.json().catch(() => null)) as { uuid?: string } | null
    if (res.ok && json?.uuid) return { uuid: json.uuid, engineUrl: config.onsiteEngineUrl }
    log.warn('payfast.onsite.unavailable', { m_payment_id: mPaymentId, status: res.status, body: json })
  } catch (err) {
    log.warn('payfast.onsite.unavailable', { m_payment_id: mPaymentId, error: err instanceof Error ? err.message : String(err) })
  }
  return null
}

const Body = z.object({
  tier: z.enum(BET_TIERS.map(t => t.tier) as [string, ...string[]]),
  courseId: uuid,
  holeId: uuid,
  userName: z.string().max(100).default(''),
  /** Tokenize the card at PayFast so the next entry is one tap (migration 021). */
  saveCard: z.boolean().default(false),
})

// ---------------------------------------------------------------------------
// POST /api/payments/payfast
// Body: { tier, courseId, holeId, userName? }
// Returns: { redirectUrl, formFields, m_payment_id, sandbox, onsite }
//
// With `onsite` the client opens PayFast's modal on the page (Onsite
// Payments) and never leaves the app; without it, it builds a hidden HTML
// form with formFields and submits it to redirectUrl (the hosted checkout). The amount comes from the tier
// table, the target hole is checked against the database, and the user,
// course, hole and tier ride inside the signed payload so the ITN can trust
// them.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const cfg = resolvePayfastConfig()
    if (!cfg.ok) {
      await alertOps({ event: 'payfast.checkout.misconfigured', path: 'payfast_checkout', summary: `Checkout refused: ${cfg.reason}` })
      return NextResponse.json({ error: 'Payments are temporarily unavailable', code: 'PAYMENTS_UNAVAILABLE' }, { status: 503 })
    }
    const { config } = cfg

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    await assertNotSuspended(supabase, user.id)
    const limited = await enforceRateLimit(RULES.checkout, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited

    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { tier, courseId, holeId, userName, saveCard } = body.data
    const tierData = BET_TIERS.find(t => t.tier === tier)!

    // ── The target must be a real, active, long-enough par-3 at a partner course ──
    const refused = await checkTarget(supabase, courseId, holeId)
    if (refused) return refused

    // Sanitize userName to prevent injection into PayFast form fields
    const safeUserName = userName.replace(/[<>"'&]/g, '').slice(0, 100)
    const nameParts = safeUserName.trim().split(/\s+/)
    const firstName = nameParts[0] || 'Player'
    const lastName = nameParts.slice(1).join(' ') || 'Player'

    // Unguessable and collision-free; the ledger and the bet both key on it.
    const mPaymentId = `gl_${randomUUID()}`
    const origin = returnOrigin(request, config.siteUrl)
    const amount = tierData.stakeZAR.toFixed(2)

    // NOTE: email_address uses a generic address — PayFast blocks payments when
    // the buyer email matches the merchant account email (anti-fraud).
    const data: Record<string, string> = {
      merchant_id:   config.merchantId,
      merchant_key:  config.merchantKey,
      // The reference rides on the return URL so the return page can finish
      // the purchase even when the browser that comes back is not the one
      // that left (an installed iOS app hands PayFast to an in-app browser
      // with its own storage; localStorage.pf_pending is missing there).
      return_url:    `${origin}/payment-return?ref=${mPaymentId}`,
      cancel_url:    `${origin}/choose-stake`,
      notify_url:    `${config.siteUrl}/api/payments/payfast/notify`,
      name_first:    firstName,
      name_last:     lastName,
      email_address: 'payments@getluckygolf.co.za',
      m_payment_id:  mPaymentId,
      amount,
      item_name:     `Get Lucky Golf - R${tierData.stakeZAR} Entry`,
      currency:      'ZAR',
      // Who and what this payment is for. PayFast echoes these back on the ITN,
      // and they sit inside the signed payload — so the browser cannot alter the
      // user, course, hole or tier without breaking the MD5 signature.
      custom_str1:   user.id,
      custom_str2:   courseId,
      custom_str3:   holeId,
      custom_str4:   tierData.tier,
    }
    // Tokenization: PayFast stores the card and returns a token on the ITN,
    // which /api/payments/payfast/notify keeps in payment_cards.
    if (saveCard) data.subscription_type = '2'

    const signature = generateSignature(data, config.passphrase)
    const onsite = await onsiteIdentifier(config, pfParamString(data, signature), mPaymentId)

    log.info('payfast.checkout.created', { user_id: user.id, tier: tierData.tier, amount, course_id: courseId, hole_id: holeId, sandbox: config.sandbox, m_payment_id: mPaymentId, onsite: !!onsite, origin, save_card: saveCard })

    return NextResponse.json({
      redirectUrl:  config.processUrl,
      formFields:   { ...data, signature },
      m_payment_id: mPaymentId,
      sandbox:      config.sandbox,
      // The modal, when PayFast gave us an identifier; null means the client
      // posts the form to the hosted page as before.
      onsite,
    })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('payfast.checkout.failed', err, { path: 'payfast_checkout', message: 'Could not start the payment. Please try again.' })
  }
}
