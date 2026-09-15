'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'
import { useBet, BET_TIERS, BetTier } from '@/context/BetContext'
import { useAuth } from '@/context/AuthContext'

type LoadingStep = 'idle' | 'opening'

function formatRand(n: number) {
  return `R${n.toLocaleString('en-ZA').replace(/,/g, ' ')}`
}

/** Short prize label for the badge: R25K, R100K, R1M. */
function prizeShort(win: number) {
  if (win >= 1_000_000) return 'R1M'
  if (win >= 1_000) return `R${Math.round(win / 1000)}K`
  return `R${win}`
}

/**
 * Choose stake — the "committing money" screen, in the V2 system.
 *
 * Same surface and rhythm as Select Course: display title, the course line,
 * one white card per tier with the stake in display type and the prize in a
 * lime badge. Tapping a card opens the confirm sheet above the tab bar with
 * the lime PAY & PLAY button; that button hands off to PayFast exactly as
 * before (signed fields from /api/payments/payfast, session saved to
 * localStorage for the return leg, hidden-form POST).
 */
export default function ChooseStakePage() {
  const router = useRouter()
  const { selectedCourse, selectedHole, selectTier } = useBet()
  const { user, profile } = useAuth()
  const [selected, setSelected]     = useState<BetTier | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [step, setStep]             = useState<LoadingStep>('idle')
  const [errorMsg, setErrorMsg]     = useState('')

  const loading = step !== 'idle'
  const activeTier = BET_TIERS.find(t => t.tier === selected)

  // Guard: if no course selected, send back to select-course
  useEffect(() => {
    if (!selectedCourse || !selectedHole) {
      router.replace('/select-course')
    }
  }, [selectedCourse, selectedHole, router])

  function handleSelectTier(tier: BetTier) {
    if (loading) return
    setSelected(tier)
    setErrorMsg('')
    setConfirming(true)
  }

  async function handleConfirmPayment() {
    if (!selected) return
    setStep('opening')
    setErrorMsg('')
    selectTier(selected)

    try {
      // ── 1. Get signed form fields from our server ─────────────────────────
      const pfRes = await fetch('/api/payments/payfast', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: selected,
          userName: profile?.name ?? user?.user_metadata?.full_name ?? '',
          // Carried into the signed PayFast payload so the ITN can record what
          // was actually paid for — the bet is built from that, not from here.
          courseId: selectedCourse?.id,
          holeId:   selectedHole?.id,
        }),
      })
      const pfData = await pfRes.json()

      if (!pfRes.ok || !pfData?.redirectUrl || !pfData?.formFields) {
        throw new Error(pfData?.error ?? 'Failed to initialise payment')
      }

      // ── 2. Save session data to localStorage (survives redirect) ──────────
      // When the user returns from PayFast, the React context is gone.
      // The payment-return page reads this to create the bet + restore context.
      localStorage.setItem('pf_pending', JSON.stringify({
        m_payment_id: pfData.m_payment_id,
        tier: selected,
        courseId:      selectedCourse?.id,
        holeId:       selectedHole?.id,
        course:       selectedCourse,
        hole:         selectedHole,
      }))

      // ── 3. Build hidden form and submit → redirect to PayFast ─────────────
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = pfData.redirectUrl

      for (const [key, value] of Object.entries(pfData.formFields)) {
        const input = document.createElement('input')
        input.type  = 'hidden'
        input.name  = key
        input.value = String(value)
        form.appendChild(input)
      }

      document.body.appendChild(form)
      form.submit() // User leaves the app → PayFast hosted checkout

    } catch (err: unknown) {
      console.error('[PayFast] handleConfirm error:', err)
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setErrorMsg(msg)
      setStep('idle')
    }
  }

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="cs-head">
          <h1 className="v2-title cs-title" style={{ marginBottom: 8 }}>{'Choose\nyour stake'}</h1>
          {selectedCourse && selectedHole && (
            <p className="stake-course">
              {selectedCourse.name} <i>|</i> Hole {selectedHole.holeNumber} <i>|</i> Par {selectedHole.par} <i>|</i> {selectedHole.distanceMetres}m
              <button type="button" className="stake-change" onClick={() => router.push('/select-course')}>Change</button>
            </p>
          )}
        </div>

        <div className={`cs-list stake-list${confirming ? ' cs-list--sheet-open' : ''}`} aria-label="Stake tiers">
          {BET_TIERS.map((tier, i) => {
            const isSelected = selected === tier.tier
            return (
              <button
                key={tier.tier}
                type="button"
                className={`stake-card${isSelected ? ' is-selected' : ''}`}
                style={{ animationDelay: `${i * 40}ms` }}
                onClick={() => handleSelectTier(tier.tier)}
                aria-pressed={isSelected}
                disabled={loading}
              >
                <span className="stake-amount">
                  {formatRand(tier.stakeZAR)}
                  <small>stake</small>
                </span>
                <span className="stake-mult">{tier.multiplier}&times;</span>
                <span className="stake-win">
                  <small>win</small>
                  {prizeShort(tier.winZAR)}
                </span>
              </button>
            )
          })}

          <p className="stake-trust">
            <LockIcon /> Secure checkout via PayFast
            <span className="stake-trust-sep">&middot;</span>
            <ShieldIcon /> Prizes insured by Indwe (FSP 3425)
          </p>
          {errorMsg && !confirming && (
            <div className="auth-error" role="alert">Payment didn&apos;t start. Tap a stake to try again.</div>
          )}
        </div>

        {confirming && activeTier && selectedCourse && selectedHole && (
          <>
            <div className="stake-backdrop" onClick={() => !loading && setConfirming(false)} />
            <div className="cs-sheet stake-sheet" role="dialog" aria-modal="true" aria-label="Confirm your entry">
              <div className="cs-sheet-top">
                <div>
                  <div className="stake-sheet-title">Confirm your entry</div>
                </div>
                {!loading && (
                  <button type="button" className="cs-sheet-close" aria-label="Cancel" onClick={() => setConfirming(false)}>×</button>
                )}
              </div>

              <dl className="stake-rows">
                <div><dt>Course</dt><dd>{selectedCourse.name}</dd></div>
                <div><dt>Hole</dt><dd>Hole {selectedHole.holeNumber} · Par {selectedHole.par} · {selectedHole.distanceMetres}m</dd></div>
                <div><dt>Your stake</dt><dd>{formatRand(activeTier.stakeZAR)}</dd></div>
                <div className="stake-rows-win"><dt>You could win</dt><dd>{formatRand(activeTier.winZAR)}</dd></div>
              </dl>

              {errorMsg && (
                <div className="auth-error" role="alert" style={{ marginBottom: 12 }}>{errorMsg}</div>
              )}

              <button
                type="button"
                className="btn-lime btn-lime--block"
                onClick={handleConfirmPayment}
                disabled={loading}
              >
                <LockIcon />
                {loading ? 'Opening PayFast…' : `Pay ${formatRand(activeTier.stakeZAR)} & play`}
              </button>

              <p className="stake-sheet-legal">
                Secure payment via PayFast. Prizes fully insured by Indwe Risk Services (FSP 3425).{' '}
                <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
              </p>
            </div>
          </>
        )}

        <BottomTabBar active="play" />
      </div>
    </PhoneFrame>
  )
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 4 6.5v5c0 4.6 3.2 8.9 8 10 4.8-1.1 8-5.4 8-10v-5L12 3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}
