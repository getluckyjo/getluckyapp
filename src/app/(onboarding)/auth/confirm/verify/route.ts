import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { finishSignIn, safeNext } from '@/lib/auth/finish-sign-in'

const OTP_TYPES: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']

/**
 * Turns a magic-link `token_hash` into a session. Reached by the form on
 * /auth/confirm — a POST, deliberately, so a mail-provider link scanner that
 * GETs every URL in an email cannot burn the one-time token before the golfer
 * taps it.
 *
 * Unlike the PKCE `code` flow this does not need the browser that requested
 * the link: the token_hash is self-contained, so opening the email on the
 * phone after asking for it on a laptop works.
 */
export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url)
  const form = await request.formData()
  const tokenHash = String(form.get('token_hash') ?? '')
  const rawType = String(form.get('type') ?? 'magiclink')
  const next = safeNext(String(form.get('next') ?? ''))

  const type = (OTP_TYPES as string[]).includes(rawType) ? (rawType as EmailOtpType) : 'magiclink'

  if (!tokenHash) {
    return NextResponse.redirect(`${origin}/auth?error=link_invalid`, 303)
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (error) {
      console.error('[auth-confirm] verifyOtp failed:', error.message)
      return NextResponse.redirect(`${origin}/auth?error=link_expired`, 303)
    }

    const response = await finishSignIn(supabase, origin, next)
    // finishSignIn answers a GET-style 307; after a POST the browser must
    // switch to GET or it will re-POST the form to the destination.
    return NextResponse.redirect(response.headers.get('location') ?? `${origin}${next}`, 303)
  } catch (err) {
    console.error('[auth-confirm] unexpected failure:', err)
    return NextResponse.redirect(`${origin}/auth?error=oauth_error`, 303)
  }
}

export function GET(request: NextRequest) {
  // Someone (or something) opened the verify URL directly. Send them to the
  // confirm page, which holds the button; nothing is consumed by a GET.
  const url = new URL(request.url)
  url.pathname = '/auth/confirm'
  return NextResponse.redirect(url, 307)
}
