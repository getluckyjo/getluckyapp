import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { log } from '@/lib/observability/log'
import { sendWelcomeEmail } from '@/lib/email/welcome'
import { createAdminClient } from '@/lib/supabase/admin'
import { enqueue } from '@/lib/outbox'

/**
 * Where a sign-in is allowed to land. Anything else falls back to /welcome so a
 * crafted `next` can never become an open redirect.
 */
export const SAFE_NEXT_PATHS = ['/welcome', '/home', '/history', '/leaderboard', '/account', '/select-course']

export function safeNext(raw: string | null | undefined): string {
  return raw && SAFE_NEXT_PATHS.includes(raw) ? raw : '/welcome'
}

/**
 * Everything that has to happen once Supabase has a session for this browser,
 * whichever door it came through — the OAuth code exchange, a magic-link
 * token_hash, or a six-digit code typed into the sign-in screen:
 *
 *  - mark onboarding done and fire the welcome email for a first-timer
 *  - gate anyone who has not passed the 18+ check
 *  - otherwise land on `next` (the "All set" beat by default)
 *
 * Returns the redirect response. `origin` is the public origin of this
 * request; every redirect is built from it so the session cookie the client
 * just received stays on the same host.
 */
export async function finishSignIn(
  supabase: SupabaseClient,
  origin: string,
  next: string,
): Promise<NextResponse> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(`${origin}/auth?error=no_session`)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_done, age_verified_at')
    .eq('id', user.id)
    .single()

  const isNewUser = !profile?.onboarding_done

  await supabase.from('profiles').upsert({ id: user.id, onboarding_done: true })

  if (isNewUser && user.email) {
    // Queued: the outbox sends it within the minute and retries if Resend is
    // down. Only if the queue itself cannot be written is it sent inline (a
    // fire-and-forget fetch would be killed with the response).
    const name = user.user_metadata?.full_name ?? user.user_metadata?.name
    try {
      await enqueue(createAdminClient(), 'welcome_email', { email: user.email, name })
      log.info('auth.welcome_email_queued', { user_id: user.id })
    } catch (queueErr) {
      log.warn('auth.welcome_email_queue_failed', { user_id: user.id, error: String(queueErr) })
      try {
        const sent = await sendWelcomeEmail({ email: user.email, name })
        if (sent.ok) log.info('auth.welcome_email_sent', { user_id: user.id, resend_id: sent.id })
        else log.error('auth.welcome_email_failed', sent.error, { path: 'auth', user_id: user.id })
      } catch (err) {
        log.error('auth.welcome_email_failed', err, { path: 'auth', user_id: user.id })
      }
    }
  }

  if (!profile?.age_verified_at) {
    return NextResponse.redirect(`${origin}/age-check`)
  }

  return NextResponse.redirect(`${origin}${safeNext(next)}`)
}
