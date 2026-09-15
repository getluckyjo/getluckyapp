'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
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

export default function AgeCheckPage() {
  const router = useRouter()
  const { user, refreshProfile, signOut } = useAuth()
  const [dob, setDob] = useState('')
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)

  // Bound the date picker to plausible adult birthdates.
  const today = new Date()
  const maxDate = today.toISOString().slice(0, 10)

  async function handleConfirm() {
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
        <div className="screen-payment" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '100%', padding: '0 var(--page-px)' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-md)' }}>🔞</div>
            <h3 className="signup-title" style={{ marginBottom: 'var(--space-sm)' }}>You must be 18 or older</h3>
            <p className="signup-sub" style={{ marginBottom: 'var(--space-lg)' }}>
              Get Lucky Golf is a real-money challenge available only to South African
              residents aged 18 and over. You&apos;ve been signed out.
            </p>
            <a href="https://www.responsiblegambling.org.za" target="_blank" rel="noopener noreferrer" className="auth-terms-link" style={{ fontSize: 'var(--text-xs)' }}>
              National Responsible Gambling Programme
            </a>
          </div>
        </div>
      </PhoneFrame>
    )
  }

  return (
    <PhoneFrame statusTheme="dark">
      <div className="screen-payment">
        <AppHeader tone="light" />
        <div className="signup-title-area" style={{ padding: 'clamp(8px, 2vh, 20px) var(--page-px) var(--space-md)' }}>
          <h3 className="signup-title">One quick check</h3>
          <p className="signup-sub">You must be 18+ and a South African resident to play for real money.</p>
        </div>

        <div style={{ padding: '0 var(--page-px)', display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
            <span style={{ fontSize: 'var(--text-body)', fontWeight: 700, color: '#1a3d2e' }}>Date of birth</span>
            <input
              type="date"
              value={dob}
              max={maxDate}
              onChange={(e) => { setDob(e.target.value); setError(null) }}
              style={{
                width: '100%',
                padding: 'var(--space-md)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid rgba(26, 61, 46, 0.2)',
                fontSize: 'var(--text-body)',
                background: '#fff',
                color: '#1a3d2e',
              }}
            />
          </label>

          <label style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => { setConsent(e.target.checked); setError(null) }}
              style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0, accentColor: 'var(--gold, #c9a94e)' }}
            />
            <span style={{ fontSize: 'var(--text-xs)', color: '#5a7a6a', lineHeight: 1.5 }}>
              I confirm I am 18 or older and a South African resident, and I agree to the{' '}
              <a href="/terms" className="auth-terms-link" target="_blank" rel="noopener noreferrer">Terms</a>,{' '}
              <a href="/privacy" className="auth-terms-link" target="_blank" rel="noopener noreferrer">Privacy Policy</a>, and{' '}
              <a href="/responsible-play" className="auth-terms-link" target="_blank" rel="noopener noreferrer">Responsible Play</a> guidelines.
            </span>
          </label>

          {error && <div className="auth-error">{error}</div>}
        </div>

        <div style={{ padding: 'var(--space-xl) var(--page-px) var(--space-2xl)' }}>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={loading}
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Confirming...' : 'Confirm & Continue'}
          </button>
        </div>
      </div>
    </PhoneFrame>
  )
}
