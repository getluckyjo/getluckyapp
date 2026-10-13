import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { resolveStitchConfig, siteHost } from '@/lib/stitch/config'
import { validateApplePayMerchant } from '@/lib/stitch/api'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { apiError, parseBody } from '@/lib/api/http'
import { log } from '@/lib/observability/log'

const Body = z.object({
  validationUrl: z.string().url().max(2000),
  /** The page's host, as the Stitch SDK reports it; must be ours. */
  initiativeContext: z.string().min(1).max(253),
})

/**
 * POST /api/payments/wallet/validate — the Apple Pay merchant session.
 *
 * When the Apple Pay sheet opens, Safari hands the page a validation URL
 * and waits for a merchant session. Stitch holds the merchant certificate,
 * so the page sends the URL here and this asks Stitch. Only a signed-in
 * golfer may ask, only for our own host, and only on an apple.com URL:
 * a session is cheap to make but it carries our merchant name.
 */
export async function POST(request: NextRequest) {
  try {
    const cfg = resolveStitchConfig()
    if (!cfg.ok) return NextResponse.json({ error: 'Apple Pay is not available right now.', code: 'WALLET_UNAVAILABLE' }, { status: 503 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    const limited = await enforceRateLimit(RULES.checkout, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited

    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { validationUrl, initiativeContext } = body.data

    const expectedHost = siteHost(cfg.config)
    if (initiativeContext.toLowerCase() !== expectedHost.toLowerCase()) {
      log.warn('stitch.applepay.wrong_host', { user_id: user.id, given: initiativeContext, expected: expectedHost })
      return NextResponse.json({ error: 'Apple Pay can only be started from the app.', code: 'WRONG_HOST' }, { status: 400 })
    }
    const host = new URL(validationUrl).hostname
    if (!/(^|\.)apple\.com$/i.test(host)) {
      log.warn('stitch.applepay.bad_validation_url', { user_id: user.id, host })
      return NextResponse.json({ error: 'Invalid validation URL', code: 'INVALID_INPUT' }, { status: 400 })
    }

    const session = await validateApplePayMerchant(cfg.config, { validationUrl, initiativeContext: expectedHost })
    return NextResponse.json({ session })
  } catch (err) {
    return apiError('stitch.applepay.validate_failed', err, { path: 'payfast_checkout', message: 'Apple Pay could not start. Pay another way below.' })
  }
}
