'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'
import StepBar from '@/components/layout/StepBar'
import { GoogleIcon, FacebookIcon } from '@/components/icons'
import { useAuth } from '@/context/AuthContext'

type Mode = 'idle' | 'email' | 'sent'

/**
 * Sign in — "Sign In Page.png".
 * READY TO GET LUCKY?, the social-proof line, a lime SIGN IN (email magic
 * link), Google and Facebook tiles, step 1 of 3, the legal line, tab bar.
 */
function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { signInWithGoogle, signInWithFacebook, signInWithMagicLink, user } = useAuth()

  const [mode, setMode] = useState<Mode>('idle')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<null | 'google' | 'facebook' | 'email'>(null)
  const [error, setError] = useState<string | null>(null)

  const oauthError = searchParams.get('error')
  // Set by the proxy when it bounced someone off a signed-in-only route.
  const next = searchParams.get('next')

  useEffect(() => {
    if (user) router.push(next ?? '/welcome')
  }, [user, next, router])

  async function handleGoogle() {
    setError(null)
    setBusy('google')
    try {
      await signInWithGoogle(next ?? undefined)
    } catch {
      setError('Google sign-in is unavailable right now. Please try again.')
      setBusy(null)
    }
  }

  async function handleFacebook() {
    setError(null)
    setBusy('facebook')
    const { error: fbError } = await signInWithFacebook(next ?? undefined)
    if (fbError) {
      setError('Facebook sign-in is unavailable right now. Please use Google or email.')
      setBusy(null)
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.')
      return
    }
    setError(null)
    setBusy('email')
    const { error: linkError } = await signInWithMagicLink(trimmed)
    setBusy(null)
    if (linkError) {
      setError('We couldn’t send that link. Please check the address and try again.')
      return
    }
    setMode('sent')
  }

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="v2-body">
          <div className="v2-hero">
            <h1 className="v2-title">{'Ready to\nget lucky?'}</h1>
            <p className="v2-sub">
              {next
                ? 'Sign in to place your bet.\nIt takes one tap.'
                : 'Sign in &\nJoin 15 000+\nGolfers already playing...'}
            </p>

            {(oauthError || error) && (
              <div className="auth-error" role="alert">
                {error ?? 'Sign-in failed. Please try again.'}
              </div>
            )}

            <div className="signin-actions">
              {mode === 'idle' && (
                <button type="button" className="btn-lime" onClick={() => setMode('email')}>
                  Sign in
                </button>
              )}

              {mode === 'email' && (
                <form className="signin-email" onSubmit={handleEmail}>
                  <label htmlFor="signin-email" className="sr-only">Email address</label>
                  <div className="signin-email-row">
                    <input
                      id="signin-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoFocus
                      placeholder="you@email.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                    />
                    <button type="submit" className="btn-lime" disabled={busy === 'email'}>
                      {busy === 'email' ? 'Sending' : 'Send link'}
                    </button>
                  </div>
                  <button type="button" className="signin-cancel" onClick={() => { setMode('idle'); setError(null) }}>
                    Back
                  </button>
                </form>
              )}

              {mode === 'sent' && (
                <div className="signin-sent" role="status">
                  <strong>Check your inbox.</strong> We sent a sign-in link to {email.trim()}.
                  Open it on this device to continue.
                </div>
              )}

              <span className="signin-or">or sign in with</span>

              <div className="signin-social">
                <button
                  type="button"
                  className="btn-tile"
                  onClick={handleGoogle}
                  disabled={busy !== null}
                >
                  <GoogleIcon size={22} />
                  {busy === 'google' ? 'Opening…' : 'Google'}
                </button>
                <button
                  type="button"
                  className="btn-tile"
                  onClick={handleFacebook}
                  disabled={busy !== null}
                >
                  <FacebookIcon size={22} />
                  {busy === 'facebook' ? 'Opening…' : 'Facebook'}
                </button>
              </div>
            </div>

            <StepBar step={1} tone="light" className="v2-step" />

            <p className="v2-legal">
              By continuing, you agree to our <a href="/terms">Terms of Service</a>{' '}
              and <a href="/privacy">Privacy Policy</a>
            </p>
          </div>
        </div>

        <BottomTabBar active="play" />
      </div>
    </PhoneFrame>
  )
}

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <PhoneFrame statusTheme="dark">
          <div className="v2-screen" />
        </PhoneFrame>
      }
    >
      <AuthForm />
    </Suspense>
  )
}
