'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'

type Profile = Database['public']['Tables']['profiles']['Row']

interface AuthContextValue {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  signInWithGoogle: (next?: string) => Promise<void>
  signInWithFacebook: (next?: string) => Promise<{ error: string | null }>
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>
  verifyEmailCode: (email: string, code: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  // Stable instance — createClient() in the render body built a new client on
  // every render, re-subscribing auth listeners each time.
  const [supabase] = useState(createClient)
  const profileLoadedRef = useRef<string | null>(null)

  async function loadProfile(userId: string, force = false) {
    // Skip if we already loaded for this user (dedup getSession + onAuthStateChange)
    if (!force && profileLoadedRef.current === userId) return
    profileLoadedRef.current = userId
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    setProfile(data)
  }

  async function refreshProfile() {
    if (user) await loadProfile(user.id, true)
  }

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      setLoading(false)
    })

    // Listen for auth changes (skips INITIAL_SESSION via dedup ref)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        loadProfile(session.user.id)
      } else {
        profileLoadedRef.current = null
        setProfile(null)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // `next` is where to land after the callback. The callback allow-lists it
  // against SAFE_PATHS, so an unexpected value falls back to /home rather than
  // becoming an open redirect.
  function callbackUrl(next?: string) {
    const callback = new URL('/auth/callback', window.location.origin)
    if (next) callback.searchParams.set('next', next)
    return callback.toString()
  }

  async function signInWithGoogle(next?: string) {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl(next) },
    })
  }

  // Facebook is a V2 design addition. It needs the provider enabled in the
  // Supabase dashboard; until then Supabase answers with an error, which the
  // sign-in screen turns into a "use Google or email" message.
  async function signInWithFacebook(next?: string) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: { redirectTo: callbackUrl(next) },
    })
    return { error: error?.message ?? null }
  }

  async function signInWithMagicLink(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl(),
      },
    })
    return { error: error?.message ?? null }
  }

  // The six-digit code from the same email. Scanner-proof and device-agnostic:
  // it does not care which browser asked for it, unlike the PKCE link.
  async function verifyEmailCode(email: string, code: string) {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      user, session, profile, loading,
      signInWithGoogle, signInWithFacebook, signInWithMagicLink, verifyEmailCode, signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
