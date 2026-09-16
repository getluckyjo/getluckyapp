import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { log } from '@/lib/observability/log'

// A sign-in credential that lands here (Supabase's Site URL fallback) is
// forwarded to /auth/callback or /auth/confirm by the proxy before this
// page ever renders — see src/proxy.ts.

// This page reads the session cookie on every request. Saying so stops the
// build from attempting a static render, which would throw Next's
// "dynamic server usage" bailout into the catch below and log it as an error.
export const dynamic = 'force-dynamic'

export default async function RootPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  let session = null
  // The installed app launches at /?source=pwa; carry the marker through the
  // redirect so the first screen can tell an icon launch from a browser visit.
  const { source } = await searchParams
  const suffix = source === 'pwa' ? '?source=pwa' : ''

  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getSession()
    session = data.session
  } catch (err) {
    // Supabase unreachable — fall through to splash rather than a 500 on the root.
    log.error('root.session_check_failed', err)
  }

  if (!session) {
    redirect(`/splash${suffix}`)
  }

  redirect(`/home${suffix}`)
}
