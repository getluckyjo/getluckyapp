import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { resend } from '@/lib/resend'
import { renderAuthEmail } from '@/lib/email/auth-emails'
import { verifyStandardWebhook } from '@/lib/email/standard-webhooks'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import { z } from 'zod'
import { FROM_ADDRESS } from '@/lib/email/from'


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

  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return hookError(400, 'Invalid JSON')
  }
  const parsed = HookPayload.safeParse(raw)
  if (!parsed.success) {
    log.warn('auth.email_hook.bad_payload', { issues: parsed.error.issues.map(i => i.path.join('.')) })
    return hookError(400, 'Missing user email or token')
  }
  const payload = parsed.data
  const to = payload.user.email
  const data = payload.email_data

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

const HookPayload = z.object({
  user: z.object({
    id: z.string().optional(),
    email: z.email(),
    new_email: z.string().nullable().optional(),
  }),
  email_data: z.object({
    token: z.string().min(1),
    token_hash: z.string().min(1),
    redirect_to: z.string().optional(),
    email_action_type: z.string().min(1),
    site_url: z.string().optional(),
    token_new: z.string().optional(),
    token_hash_new: z.string().optional(),
  }),
})
