import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { resend } from '@/lib/resend'
import { renderAuthEmail } from '@/lib/email/auth-emails'
import { verifyStandardWebhook } from '@/lib/email/standard-webhooks'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'

const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS ?? 'Get Lucky Golf <noreply@getluckygolf.co.za>'

/**
 * Supabase "Send Email" auth hook.
 *
 * With this hook enabled, Supabase stops sending its own auth emails (which go
 * out through a rate-limited shared mailer with an unbranded template) and
 * instead POSTs the token here. We render the V2 email and send it through
 * Resend from the verified getluckygolf.co.za domain.
 *
 * Configure in Supabase → Authentication → Hooks → Send Email:
 *   URL:    https://www.getluckyholeinone.com/api/auth/send-email
 *   Secret: copy into the SEND_EMAIL_HOOK_SECRET environment variable
 *
 * Every request is signature-checked; an unsigned or stale request is refused
 * and nothing is sent. Supabase expects a 200 with an empty JSON object.
 */
export async function POST(request: NextRequest) {
  const secret = (process.env.SEND_EMAIL_HOOK_SECRET ?? '').trim()
  const body = await request.text()

  const verdict = verifyStandardWebhook({
    secret,
    body,
    headers: {
      id: request.headers.get('webhook-id'),
      timestamp: request.headers.get('webhook-timestamp'),
      signature: request.headers.get('webhook-signature'),
    },
  })

  if (!verdict.ok) {
    log.warn('auth.email_hook.rejected', { reason: verdict.reason })
    return hookError(401, `Unauthorised: ${verdict.reason}`)
  }

  let payload: HookPayload
  try {
    payload = JSON.parse(body)
  } catch {
    return hookError(400, 'Invalid JSON')
  }

  const to = payload.user?.email
  const data = payload.email_data
  if (!to || !data?.token || !data?.token_hash) {
    return hookError(400, 'Missing user email or token')
  }

  const email = renderAuthEmail({
    type: data.email_action_type,
    to,
    token: data.token,
    tokenHash: data.token_hash,
    redirectTo: data.redirect_to,
    newEmail: payload.user?.new_email ?? undefined,
    tokenNew: data.token_new || undefined,
    tokenHashNew: data.token_hash_new || undefined,
  })

  const { data: sent, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers: { 'X-Entity-Ref-ID': data.token_hash.slice(0, 32) },
  })

  if (error) {
    await alertOps({ event: 'auth.email_hook.send_failed', path: 'auth', summary: 'Resend refused an auth email; sign-ins are failing.', details: { action: data.email_action_type }, err: error })
    return hookError(500, 'Email provider refused the message')
  }

  log.info('auth.email_hook.sent', { action: data.email_action_type, resend_id: sent?.id ?? null })
  return NextResponse.json({})
}

/** Supabase surfaces this shape to the caller of signInWithOtp etc. */
function hookError(status: number, message: string) {
  return NextResponse.json({ error: { http_code: status, message } }, { status })
}

interface HookPayload {
  user?: {
    id?: string
    email?: string
    new_email?: string | null
    user_metadata?: Record<string, unknown>
  }
  email_data?: {
    token: string
    token_hash: string
    redirect_to?: string
    email_action_type: string
    site_url?: string
    token_new?: string
    token_hash_new?: string
  }
}
