import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotSuspended, claimErrorResponse } from '@/lib/claims/state-machine'
import { resolveStitchConfig } from '@/lib/stitch/config'
import { consentRedirectUrl, createConsentRequest } from '@/lib/stitch/cards'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { apiError } from '@/lib/api/http'
import { log } from '@/lib/observability/log'

/**
 * POST /api/payments/card/stitch — start adding a card to the account.
 *
 * Creates a Stitch payment consent request, remembers it against the
 * golfer (stitch_consent_requests) and answers { url }: Stitch's hosted
 * page, with our return leg appended. The page takes the card number and
 * the bank's 3-D Secure step; we never see the number. The return leg
 * (./return) and the webhook attach the card once Stitch says it is
 * granted. A golfer who already has a card is told to remove it first:
 * one card per account, whoever holds it.
 */
export async function POST(request: NextRequest) {
  try {
    const cfg = resolveStitchConfig()
    if (!cfg.ok) return NextResponse.json({ error: 'Adding a card is not available right now.', code: 'CARDS_UNAVAILABLE' }, { status: 503 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    const limited = await enforceRateLimit(RULES.checkout, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited
    await assertNotSuspended(supabase, user.id)

    const admin = createAdminClient()
    const { data: existing } = await admin.from('payment_cards').select('provider').eq('user_id', user.id).maybeSingle()
    if (existing) return NextResponse.json({ error: 'You already have a saved card. Remove it first to add another.', code: 'CARD_EXISTS' }, { status: 409 })

    const consent = await createConsentRequest(cfg.config, { nonce: randomUUID() })
    const { error } = await admin.from('stitch_consent_requests').insert({ id: consent.id, user_id: user.id, status: 'pending' })
    if (error) return apiError('stitch.consent.record_failed', error, { path: 'payfast_checkout', message: 'Could not start adding a card. Please try again.' })

    log.info('stitch.consent.started', { user_id: user.id, consent_id: consent.id })
    return NextResponse.json({ url: consentRedirectUrl(consent.url, `${cfg.config.siteUrl}/api/payments/card/stitch/return`) })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('stitch.consent.start_failed', err, { path: 'payfast_checkout', message: 'Could not start adding a card. Please try again.' })
  }
}
