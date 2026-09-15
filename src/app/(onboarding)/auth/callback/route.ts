import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { finishSignIn, safeNext } from '@/lib/auth/finish-sign-in'
import { log } from '@/lib/observability/log'

/**
 * Where Supabase sends the browser back after Google (PKCE `code`),
 * and where the sign-in screen sends it after a six-digit code has already
 * created a session client-side (no `code`; the cookie is enough).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  try {
    const supabase = await createClient()

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        // Logged so the production trail says *why* — the two usual causes are
        // a code verifier that lives on a different host (www vs bare domain)
        // and a link that a mail scanner already consumed.
        log.error('auth.callback.exchange_failed', error, { path: 'auth' })
        return NextResponse.redirect(`${origin}/auth?error=oauth_error`)
      }
    }

    return await finishSignIn(supabase, origin, next)
  } catch (err) {
    // Supabase unreachable or misconfigured. A sign-in screen with a message
    // beats a bare 500 in the golfer's face.
    log.error('auth.callback.unhandled', err, { path: 'auth' })
    return NextResponse.redirect(`${origin}/auth?error=oauth_error`)
  }
}
