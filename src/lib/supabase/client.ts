import { createBrowserClient } from '@supabase/ssr'

// Next inlines NEXT_PUBLIC_* at build time. A preview deployment without them
// must still prerender: this module is only ever exercised in the browser, so a
// missing key should surface there as a failed request, not as a dead build.
// Before this guard, every preview build failed prerendering /result/claim with
// "@supabase/ssr: Your project's URL and API key are required".
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

export const isSupabaseConfigured = !!SUPABASE_URL && !!SUPABASE_ANON_KEY

// Inferred from a real call so call sites keep the exact type they had before
// this file was memoised — annotating with ReturnType<typeof createBrowserClient>
// resolves the generic differently and breaks inference downstream.
function build(url: string, key: string) {
  return createBrowserClient(url, key)
}

let cached: ReturnType<typeof build> | null = null

/** Browser Supabase client. Memoised — a new client per render re-subscribes auth listeners. */
export function createClient() {
  if (cached) return cached

  if (!isSupabaseConfigured) {
    if (typeof window !== 'undefined') {
      console.error(
        '[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing or still ' +
        'placeholders. Sign-in and every data call will fail until they are set for this environment.',
      )
    }
    // Syntactically valid placeholders keep prerender alive; real calls fail loudly at runtime.
    cached = build('https://placeholder.supabase.co', 'placeholder-anon-key')
    return cached
  }

  cached = build(SUPABASE_URL, SUPABASE_ANON_KEY)
  return cached
}
