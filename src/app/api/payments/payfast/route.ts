import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { assertNotSuspended, claimErrorResponse } from '@/lib/claims/state-machine'
import { log } from '@/lib/observability/log'

// ---------------------------------------------------------------------------
// Config — sandbox by default; set PAYFAST_SANDBOX=false for production
// ---------------------------------------------------------------------------
const MERCHANT_ID  = (process.env.PAYFAST_MERCHANT_ID  ?? '10000100').trim()
const MERCHANT_KEY = (process.env.PAYFAST_MERCHANT_KEY ?? '46f0cd694581a').trim()
const PASSPHRASE   = (process.env.PAYFAST_PASSPHRASE   ?? '').trim()
const SANDBOX      = (process.env.PAYFAST_SANDBOX ?? 'true').trim() !== 'false'
const SITE_URL     = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').trim()

// Redirect checkout URL (not onsite — supports Apple Pay, Google Pay, etc.)
const REDIRECT_URL = SANDBOX
  ? 'https://sandbox.payfast.co.za/eng/process'
  : 'https://www.payfast.co.za/eng/process'

// ---------------------------------------------------------------------------
// ZAR stake amounts per tier (ASCII-safe item names — no special chars)
// ---------------------------------------------------------------------------
const TIER_ZAR: Record<string, { amount: string; itemName: string }> = {
  tier_1: { amount: '50.00',   itemName: 'Get Lucky Golf - R50 Entry'   },
  tier_2: { amount: '100.00',  itemName: 'Get Lucky Golf - R100 Entry'  },
  tier_6: { amount: '150.00',  itemName: 'Get Lucky Golf - R150 Entry'  },
  tier_3: { amount: '250.00',  itemName: 'Get Lucky Golf - R250 Entry'  },
  tier_4: { amount: '500.00',  itemName: 'Get Lucky Golf - R500 Entry'  },
  tier_5: { amount: '1000.00', itemName: 'Get Lucky Golf - R1000 Entry' },
}

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

// ---------------------------------------------------------------------------
// URL-encode a value per PayFast spec: spaces → +, trim whitespace
// ---------------------------------------------------------------------------
function pfEncode(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%20/g, '+')
}

// ---------------------------------------------------------------------------
// Generate MD5 signature from ordered params
// ---------------------------------------------------------------------------
function generateSignature(data: Record<string, string>, passphrase: string): string {
  const parts: string[] = []
  for (const key of PF_FIELD_ORDER) {
    if (data[key] !== undefined && data[key] !== '') {
      parts.push(`${key}=${pfEncode(data[key])}`)
    }
  }
  const paramString = parts.join('&')

  const sigInput = passphrase.trim()
    ? `${paramString}&passphrase=${pfEncode(passphrase)}`
    : paramString

  return crypto.createHash('md5').update(sigInput).digest('hex')
}

// ---------------------------------------------------------------------------
// POST /api/payments/payfast
// Body: { tier, userName? }
// Returns: { redirectUrl, formFields, m_payment_id, sandbox }
//
// The client builds a hidden HTML form with formFields and submits it to
// redirectUrl. The user is taken to PayFast's hosted checkout page which
// supports all payment methods (cards, EFT, Apple Pay, Google Pay, etc.)
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    // ── CSRF protection: require authenticated user ──────────────────────
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    await assertNotSuspended(supabase, user.id)

    const { tier, userName = '', courseId = '', holeId = '' } = await request.json()

    if (!courseId || !holeId) {
      return NextResponse.json({ error: 'Missing course or hole' }, { status: 400 })
    }

    const tierData = TIER_ZAR[tier as string]
    if (!tierData) {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
    }

    // Sanitize userName to prevent injection into PayFast form fields
    const safeUserName = String(userName).replace(/[<>"'&]/g, '').slice(0, 100)

    const nameParts = safeUserName.trim().split(/\s+/)
    const firstName = nameParts[0] || 'Player'
    const lastName  = nameParts.slice(1).join(' ') || 'Player'
    const mPaymentId = `gl_${tier}_${Date.now()}`

    // Assemble data (order doesn't matter — generateSignature enforces PF_FIELD_ORDER)
    // NOTE: email_address uses a generic address — PayFast blocks payments when
    // the buyer email matches the merchant account email (anti-fraud).
    const data: Record<string, string> = {
      merchant_id:   MERCHANT_ID,
      merchant_key:  MERCHANT_KEY,
      return_url:    `${SITE_URL}/payment-return`,
      cancel_url:    `${SITE_URL}/choose-stake`,
      notify_url:    `${SITE_URL}/api/payments/payfast/notify`,
      name_first:    firstName,
      name_last:     lastName,
      email_address: 'payments@getluckygolf.co.za',
      m_payment_id:  mPaymentId,
      amount:        tierData.amount,
      item_name:     tierData.itemName,
      currency:      'ZAR',
      // Who and what this payment is for. PayFast echoes these back on the ITN,
      // and they sit inside the signed payload — so the browser cannot alter the
      // user, course, hole or tier without breaking the MD5 signature. The ITN
      // writes the payments ledger from these, never from client input.
      custom_str1:   user.id,
      custom_str2:   String(courseId),
      custom_str3:   String(holeId),
      custom_str4:   tier as string,
    }

    const signature = generateSignature(data, PASSPHRASE)

    log.info('payfast.checkout.created', { user_id: user.id, tier, amount: tierData.amount, course_id: String(courseId), hole_id: String(holeId), sandbox: SANDBOX, m_payment_id: mPaymentId })

    // Return the signed form fields — client will build a hidden form and submit
    return NextResponse.json({
      redirectUrl:  REDIRECT_URL,
      formFields:   { ...data, signature },
      m_payment_id: mPaymentId,
      sandbox:      SANDBOX,
    })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    log.error('payfast.checkout.failed', err, { path: 'payfast_checkout' })
    return NextResponse.json({ error: 'Payment creation failed' }, { status: 500 })
  }
}
