import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { apiError, parseBody } from '@/lib/api/http'
import { RULES, enforceRateLimit, clientIp } from '@/lib/rate-limit'
import { BETA_COOKIE, BETA_COOKIE_MAX_AGE, betaAllowed, normaliseCode } from '@/lib/beta'
import { log } from '@/lib/observability/log'

const Body = z.object({
  code: z.string().trim().min(4).max(40),
})

/**
 * Redeem an invite code. On success the code is kept in an httpOnly cookie
 * for 90 days and the proxy lets this browser through. Pre-auth and
 * IP-rate-limited: a code is a shared secret, not a password, but nobody
 * gets to guess thousands of them.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(RULES.betaRedeem, { ip: clientIp(request) })
  if (limited) return limited

  const body = await parseBody(request, Body)
  if (!body.ok) return body.response

  try {
    const supabase = await createClient()
    const ok = await betaAllowed(supabase, { code: body.data.code })
    if (!ok) {
      log.warn('beta.redeem_rejected', { ip: clientIp(request) })
      return NextResponse.json({ error: 'That code is not on the list. Check it and try again.', code: 'BETA_CODE_INVALID' }, { status: 403 })
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set(BETA_COOKIE, normaliseCode(body.data.code), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: BETA_COOKIE_MAX_AGE,
    })
    log.info('beta.redeemed', {})
    return res
  } catch (err) {
    return apiError('beta.redeem.unhandled', err)
  }
}
