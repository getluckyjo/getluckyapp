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

const ERROR_COPY: Record<string, string> = {
  oauth_error: 'Sign-in didn’t complete. Please try again.',
  link_expired: 'That sign-in link has expired or was already used. Ask for a new one.',
  link_invalid: 'That sign-in link is incomplete. Ask for a new one.',
  no_session: 'We couldn’t start your session. Please sign in again.',
}

/**
 * Sign in — "Sign In Page.png".
 * READY TO GET LUCKY?, the social-proof line, a lime SIGN IN (email), Google
 * and Facebook tiles, step 1 of 3, the legal line, tab bar.
 *
 * Email sign-in sends a branded email carrying a six-digit code and a button.
 * The code is entered right here, so it works even when the email is opened
 * on another device or a mail scanner has already followed the link.
 */
function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { signInWithGoogle, signInWithFacebook, signInWithMagicLink, verifyEmailCode, user } = useAuth()

  const [mode, setMode] = useState<Mode>('idle')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<null | 'google' | 'facebook' | 'email' | 'code'>(null)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  const urlError = searchParams.get('error')
  // Set by the proxy when it bounced someone off a signed-in-only route.
  const next = searchParams.get('next')

  useEffect(() => {
    if (user && busy !== 'code') router.push(next ?? '/welcome')
  }, [user, next, router, busy])

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

  async function sendLink(trimmed: string) {
    setBusy('email')
    const { error: linkError } = await signInWithMagicLink(trimmed)
    setBusy(null)
    if (linkError) {
      setError(/rate|too many|seconds/i.test(linkError)
        ? 'Too many attempts. Give it a minute, then try again.'
        : 'We couldn’t send that email. Please check the address and try again.')
      return false
    }
    return true
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.')
      return
    }
    setError(null)
    if (await sendLink(trimmed)) {
      setCode('')
      setResent(false)
      setMode('sent')
    }
  }

  async function handleResend() {
    setError(null)
    if (await sendLink(email.trim())) setResent(true)
  }

  async function handleCode(e: React.FormEvent) {
    e.preventDefault()
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 6) {
      setError('Enter the six-digit code from the email.')
      return
    }
    setError(null)
    setBusy('code')
    const { error: codeError } = await verifyEmailCode(email.trim(), digits)
    if (codeError) {
      setBusy(null)
      setError(/expired|invalid/i.test(codeError)
        ? 'That code is wrong or has expired. Check the email or request a new one.'
        : 'We couldn’t verify that code. Please try again.')
      return
    }
    // A full navigation, not a client push: the session cookie the browser
    // just received must reach the server so the callback can run the
    // post-sign-in steps (age check, welcome email) exactly like OAuth does.
    const target = new URL('/auth/callback', window.location.origin)
    if (next) target.searchParams.set('next', next)
    window.location.assign(target.toString())
  }

  const shownError = error ?? (urlError ? ERROR_COPY[urlError] ?? ERROR_COPY.oauth_error : null)

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="v2-body">
          <div className="v2-hero">
            <h1 className="v2-title">
              {mode === 'sent' ? 'Check your\ninbox.' : 'Ready to\nget lucky?'}
            </h1>
            <p className="v2-sub">
              {mode === 'sent'
                ? `We sent a six-digit code to\n${email.trim()}`
                : next
                  ? 'Sign in to place your bet.\nIt takes one tap.'
                  : 'Sign in &\nJoin 15 000+\nGolfers already playing...'}
            </p>

            {shownError && (
              <div className="auth-error" role="alert">{shownError}</div>
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
                      {busy === 'email' ? 'Sending' : 'Send code'}
                    </button>
                  </div>
                  <button type="button" className="signin-cancel" onClick={() => { setMode('idle'); setError(null) }}>
                    Back
                  </button>
                </form>
              )}

              {mode === 'sent' && (
                <form className="signin-email" onSubmit={handleCode}>
                  <label htmlFor="signin-code" className="sr-only">Six-digit code</label>
                  <div className="signin-email-row">
                    <input
                      id="signin-code"
                      className="signin-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                      maxLength={6}
                      autoFocus
                      placeholder="000000"
                      value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    />
                    <button type="submit" className="btn-lime" disabled={busy === 'code'}>
                      {busy === 'code' ? 'Checking' : 'Sign in'}
                    </button>
                  </div>
                  <div className="signin-sent-actions">
                    <button type="button" className="signin-cancel" onClick={handleResend} disabled={busy === 'email'}>
                      {busy === 'email' ? 'Sending…' : resent ? 'Sent again' : 'Send a new code'}
                    </button>
                    <button type="button" className="signin-cancel" onClick={() => { setMode('email'); setError(null) }}>
                      Change email
                    </button>
                  </div>
                  <p className="signin-hint">
                    The email also has a sign-in button. It works on the phone you play from. Not there? Check spam.
                  </p>
                </form>
              )}

              {mode !== 'sent' && (
                <>
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
                </>
              )}
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
