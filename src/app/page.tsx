import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// A sign-in credential that lands here (Supabase's Site URL fallback) is
// forwarded to /auth/callback or /auth/confirm by the proxy before this
// page ever renders — see src/proxy.ts.
export default async function RootPage() {
  let session = null

  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getSession()
    session = data.session
  } catch {
    // Supabase not configured yet — fall through to splash
  }

  if (!session) {
    redirect('/splash')
  }

  redirect('/home')
}
