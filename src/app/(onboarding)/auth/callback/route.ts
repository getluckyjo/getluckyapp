import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // V2 flow: sign in → "All set! Swing your shot." → select a course. The
  // welcome beat is the default landing; a specific `next` (someone bounced
  // off /account, say) still goes straight there.
  const rawNext = searchParams.get('next') ?? '/welcome'
  // Prevent open redirect: only allow known safe paths
  const SAFE_PATHS = ['/welcome', '/home', '/history', '/leaderboard', '/account', '/select-course']
  const next = SAFE_PATHS.some(p => rawNext === p) ? rawNext : '/welcome'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // Check onboarding + age-verification state
        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_done, age_verified_at')
          .eq('id', user.id)
          .single()

        const isNewUser = !profile?.onboarding_done

        // Mark onboarding as done so the user goes straight to /home
        await supabase
          .from('profiles')
          .upsert({ id: user.id, onboarding_done: true })

        // Send welcome email to new users (fire-and-forget)
        if (isNewUser) {
          const email = user.email
          const name = user.user_metadata?.full_name ?? user.user_metadata?.name
          if (email) {
            fetch(`${origin}/api/email/welcome`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, name }),
            }).catch((err) => console.error('[auth-callback] Welcome email failed:', err))
          }
        }

        // Gate: anyone who hasn't passed the 18+ age check goes there first,
        // before they can reach any real-money flow.
        if (!profile?.age_verified_at) {
          return NextResponse.redirect(`${origin}/age-check`)
        }
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth?error=oauth_error`)
}
