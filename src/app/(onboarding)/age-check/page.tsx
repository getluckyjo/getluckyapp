'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import StepBar from '@/components/layout/StepBar'
import { useAuth } from '@/context/AuthContext'
import { createClient } from '@/lib/supabase/client'

// Whole years between a date of birth and today.
function ageFromDob(dob: string): number {
  const birth = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

/**
 * Age check — the one gate between sign-in and All set, in the V2 system.
 * Display title, a date field and a consent tile on the grey surface, one
 * lime CONFIRM. Under-18s get a plain, final screen and are signed out.
 */
export default function AgeCheckPage() {
  const router = useRouter()
  const { user, refreshProfile, signOut } = useAuth()
  const [dob, setDob] = useState('')
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)

  // Bound the date picker to plausible adult birthdates.
  const maxDate = new Date().toISOString().slice(0, 10)

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!dob) {
      setError('Please enter your date of birth.')
      return
    }

    const age = ageFromDob(dob)
    if (Number.isNaN(age) || age < 0 || age > 120) {
      setError('Please enter a valid date of birth.')
      return
    }

    if (age < 18) {
      // Under 18 — block and sign out. No bet path may be reached.
      setBlocked(true)
      await signOut()
      return
    }

    if (!consent) {
      setError('Please confirm you agree to the terms to continue.')
      return
    }

    setLoading(true)

    if (user) {
      const supabase = createClient()
      const now = new Date().toISOString()
      const { error: dbError } = await supabase.from('profiles').upsert({
        id: user.id,
        date_of_birth: dob,
        age_verified_at: now,
        terms_accepted_at: now,
        onboarding_done: true,
      })

      if (dbError) {
        setLoading(false)
        setError('Something went wrong. Please try again.')
        return
      }

      await refreshProfile()
    }

    setLoading(false)
    router.push('/welcome')
  }

  if (blocked) {
    return (
      <PhoneFrame statusTheme="dark">
        <div className="v2-screen">
          <AppHeader tone="light" />
          <div className="v2-body" style={{ paddingBottom: 'var(--space-2xl)' }}>
            <div className="v2-hero">
              <span className="ac-blocked-badge" aria-hidden>18+</span>
              <h1 className="v2-title">{'You must be\n18 or older.'}</h1>
              <p className="v2-sub">
                Get Lucky Golf is a real-money challenge for South African residents aged 18 and over. You&apos;ve been signed out.
              </p>
              <p className="v2-legal" style={{ margin: 0 }}>
                <a href="https://www.responsiblegambling.org.za" target="_blank" rel="noopener noreferrer">
                  National Responsible Gambling Programme
                </a>
              </p>
            </div>
          </div>
        </div>
      </PhoneFrame>
    )
  }

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <form className="vf-scroll ac-form" onSubmit={handleConfirm} noValidate>
          <h1 className="v2-title" style={{ marginBottom: 8 }}>{'One quick\ncheck.'}</h1>
          <p className="vf-sub">You must be 18+ and a South African resident to play for real money.</p>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <label className="acct-field">
            <span>Date of birth</span>
            <input
              className="acct-input ac-date"
              type="date"
              value={dob}
              max={maxDate}
              autoComplete="bday"
              onChange={(e) => { setDob(e.target.value); setError(null) }}
            />
          </label>

          <label className={`ac-consent${consent ? ' is-on' : ''}`}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => { setConsent(e.target.checked); setError(null) }}
            />
            <span className="ac-consent-box" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
            <span className="ac-consent-text">
              I confirm I am 18 or older and a South African resident, and I agree to the{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>,{' '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and{' '}
              <a href="/responsible-play" target="_blank" rel="noopener noreferrer">Responsible Play</a> guidelines.
            </span>
          </label>

          <button type="submit" className="btn-lime btn-lime--block ac-submit" disabled={loading}>
            {loading ? 'Confirming…' : 'Confirm & continue'}
          </button>

          <StepBar step={1} tone="light" className="v2-step" />
        </form>
      </div>
    </PhoneFrame>
  )
}
