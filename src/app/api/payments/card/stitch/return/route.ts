import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveStitchConfig } from '@/lib/stitch/config'
import { consentStatus } from '@/lib/stitch/cards'
import { attachConsent, closeConsent } from '@/lib/stitch/consent-store'
import { log } from '@/lib/observability/log'

export const dynamic = 'force-dynamic'

/**
 * GET /api/payments/card/stitch/return?id=…&status=… — back from Stitch's
 * hosted page. Lands on /account with ?card=saved|cancelled|pending|error.
 *
 * The query string is the golfer's browser and anyone can type one, so
 * nothing in it is trusted: the consent id must be one this golfer
 * started, and Stitch itself is asked what became of it. Granted → the
 * card is attached. Closed or failed → noted, nothing attached. Anything
 * else (Stitch cannot be asked, the answer is still pending) → the webhook
 * finishes it and Account says so.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const site = url.origin
  const back = (card: string) => NextResponse.redirect(`${site}/account?card=${card}`, 303)
  try {
    const id = (url.searchParams.get('id') ?? '').trim()
    const said = (url.searchParams.get('status') ?? '').trim().toLowerCase()
    if (!id) return back('error')

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.redirect(`${site}/auth?next=${encodeURIComponent('/account')}`, 303)

    const admin = createAdminClient()
    const { data: req } = await admin.from('stitch_consent_requests').select('id, user_id, status').eq('id', id).maybeSingle()
    if (!req || req.user_id !== user.id) {
      log.warn('stitch.consent.return_unknown', { user_id: user.id, consent_id: id })
      return back('error')
    }
    if (req.status === 'granted') return back('saved')

    const cfg = resolveStitchConfig()
    if (!cfg.ok) return back('pending')

    let status
    try {
      status = await consentStatus(cfg.config, id)
    } catch (err) {
      log.warn('stitch.consent.status_unreachable', { user_id: user.id, consent_id: id, error: err instanceof Error ? err.message : String(err) })
      // The page said something; the webhook will say for sure.
      return back(said === 'closed' || said === 'failed' ? 'cancelled' : 'pending')
    }

    if (status.state === 'granted') {
      await attachConsent(admin, { consentId: id, userId: user.id, card: status.card, source: 'return' })
      return back('saved')
    }
    if (status.state === 'expired' || status.state === 'revoked' || status.state === 'failed') {
      await closeConsent(admin, id, status.state === 'failed' && said === 'closed' ? 'closed' : status.state)
      return back('cancelled')
    }
    // Pending or unknown: the golfer closed the page, or Stitch is still working.
    if (said === 'closed' || said === 'failed') {
      await closeConsent(admin, id, said === 'closed' ? 'closed' : 'failed')
      return back('cancelled')
    }
    return back('pending')
  } catch (err) {
    log.error('stitch.consent.return_failed', err, { path: 'payfast_checkout' })
    return back('error')
  }
}
