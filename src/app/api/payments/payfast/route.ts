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

const Body = z.object({
  tier: z.enum(BET_TIERS.map(t => t.tier) as [string, ...string[]]),
  courseId: uuid,
  holeId: uuid,
  userName: z.string().max(100).default(''),
})

// ---------------------------------------------------------------------------
// POST /api/payments/payfast
// Body: { tier, courseId, holeId, userName? }
// Returns: { redirectUrl, formFields, m_payment_id, sandbox }
//
// The client builds a hidden HTML form with formFields and submits it to
// redirectUrl (PayFast's hosted checkout). The amount comes from the tier
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
    const { tier, courseId, holeId, userName } = body.data
    const tierData = BET_TIERS.find(t => t.tier === tier)!

    // ── The target must be a real, active par-3 hole at a partner course ──
    const { data: hole } = await supabase
      .from('holes')
      .select('id, course_id, is_active')
      .eq('id', holeId)
      .maybeSingle()
    if (!hole || hole.course_id !== courseId) {
      return NextResponse.json({ error: 'That hole is not available', code: 'HOLE_INVALID' }, { status: 400 })
    }
    if (!hole.is_active) {
      return NextResponse.json({ error: 'That hole is not currently open for the challenge', code: 'HOLE_INACTIVE' }, { status: 400 })
    }
    const { data: course } = await supabase
      .from('courses')
      .select('id, is_partner')
      .eq('id', courseId)
      .maybeSingle()
    if (!course?.is_partner) {
      return NextResponse.json({ error: 'That course is not a partner course', code: 'COURSE_NOT_PARTNER' }, { status: 400 })
    }

    // Sanitize userName to prevent injection into PayFast form fields
    const safeUserName = userName.replace(/[<>"'&]/g, '').slice(0, 100)
    const nameParts = safeUserName.trim().split(/\s+/)
    const firstName = nameParts[0] || 'Player'
    const lastName = nameParts.slice(1).join(' ') || 'Player'

    // Unguessable and collision-free; the ledger and the bet both key on it.
    const mPaymentId = `gl_${randomUUID()}`
    const amount = tierData.stakeZAR.toFixed(2)

    // NOTE: email_address uses a generic address — PayFast blocks payments when
    // the buyer email matches the merchant account email (anti-fraud).
    const data: Record<string, string> = {
      merchant_id:   config.merchantId,
      merchant_key:  config.merchantKey,
      return_url:    `${config.siteUrl}/payment-return`,
      cancel_url:    `${config.siteUrl}/choose-stake`,
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

    const signature = generateSignature(data, config.passphrase)

    log.info('payfast.checkout.created', { user_id: user.id, tier: tierData.tier, amount, course_id: courseId, hole_id: holeId, sandbox: config.sandbox, m_payment_id: mPaymentId })

    return NextResponse.json({
      redirectUrl:  config.processUrl,
      formFields:   { ...data, signature },
      m_payment_id: mPaymentId,
      sandbox:      config.sandbox,
    })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('payfast.checkout.failed', err, { path: 'payfast_checkout', message: 'Could not start the payment. Please try again.' })
  }
}
