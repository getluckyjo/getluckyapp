'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import { track } from '@/lib/analytics'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'
import { useBet, BET_TIERS, BetTier } from '@/context/BetContext'
import { useAuth } from '@/context/AuthContext'
import { formatRand } from '@/lib/format'

type LoadingStep = 'idle' | 'opening' | 'paying'

interface SavedCard { label: string; savedAt: string; lastUsedAt: string | null }

declare global {
  interface Window {
    /** PayFast's Onsite modal, defined by onsite/engine.js once loaded. */
    payfast_do_onsite_payment?: (
      opts: { uuid: string; return_url?: string; cancel_url?: string },
      callback?: (completed: boolean) => void,
    ) => void
  }
}

/** Load PayFast's Onsite script once; resolves when the modal function exists. */
function loadOnsiteEngine(src: string, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.payfast_do_onsite_payment) { resolve(); return }
    const timer = setTimeout(() => reject(new Error('PayFast Onsite script timed out')), timeoutMs)
    const done = () => {
      clearTimeout(timer)
      if (window.payfast_do_onsite_payment) resolve()
      else reject(new Error('PayFast Onsite script loaded without the modal'))
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) { existing.addEventListener('load', done, { once: true }); existing.addEventListener('error', () => reject(new Error('PayFast Onsite script failed')), { once: true }); return }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = done
    script.onerror = () => { clearTimeout(timer); reject(new Error('PayFast Onsite script failed')) }
    document.head.appendChild(script)
  })
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
 * the lime PAY & PLAY button. That button asks /api/payments/payfast for the
 * signed fields and, when PayFast also gave an Onsite identifier, opens
 * PayFast's modal right here so nobody leaves the app (an installed iOS
 * app that leaves for the hosted page comes back in a browser without
 * its session). Without an identifier it posts the hidden form to the
 * hosted page as before. Either way the reference is saved to
 * localStorage for the return leg.
 */
export default function ChooseStakePage() {
  const router = useRouter()
  const { selectedCourse, selectedHole, selectTier, confirmPayment, setBetId } = useBet()
  const { user, profile } = useAuth()
  const [selected, setSelected]     = useState<BetTier | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [step, setStep]             = useState<LoadingStep>('idle')
  const [errorMsg, setErrorMsg]     = useState('')
  // undefined while loading; null when the golfer has no saved card.
  const [savedCardState, setSavedCard] = useState<SavedCard | null | undefined>(undefined)
  const [saveCard, setSaveCard]     = useState(true)
  const savedCard = user ? savedCardState : null

  const loading = step !== 'idle'
  const activeTier = BET_TIERS.find(t => t.tier === selected)

  // Guard: if no course selected, send back to select-course
  useEffect(() => {
    if (!selectedCourse || !selectedHole) {
      router.replace('/select-course')
    }
  }, [selectedCourse, selectedHole, router])

  // A saved card (PayFast tokenization) makes the entry one tap.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    fetch('/api/payments/card')
      .then(r => (r.ok ? r.json() : { card: null }))
      .then((data: { card: SavedCard | null }) => { if (!cancelled) setSavedCard(data.card ?? null) })
      .catch(() => { if (!cancelled) setSavedCard(null) })
    return () => { cancelled = true }
  }, [user])

  /** One call charges the saved card; the bet comes back granted. */
  async function handlePayWithSavedCard() {
    if (!selected || !selectedCourse || !selectedHole) return
    setStep('paying')
    setErrorMsg('')
    selectTier(selected)
    try {
      const res = await fetch('/api/payments/payfast/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: selected, courseId: selectedCourse.id, holeId: selectedHole.id }),
      })
      const data = await res.json().catch(() => ({})) as { betId?: string; m_payment_id?: string; error?: string; code?: string }
      if (res.ok && data.betId && data.m_payment_id) {
        confirmPayment(data.m_payment_id)
        setBetId(data.betId)
        track('payment_saved_card', { tier: selected })
        router.push('/record')
        return
      }
      if (res.status === 404) {
        // The card is gone; fall back to the ordinary checkout without fuss.
        setSavedCard(null)
        setStep('idle')
        return
      }
      if (res.status === 409 && data.m_payment_id) {
        // Paid, but something else is missing (age check, for instance): the return page says what.
        router.push(`/payment-return?ref=${encodeURIComponent(data.m_payment_id)}`)
        return
      }
      setErrorMsg(data.error ?? 'Your saved card could not be charged. Pay another way below.')
      setStep('idle')
    } catch {
      setErrorMsg('Your saved card could not be charged. Pay another way below.')
      setStep('idle')
    }
  }

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
          // Tokenize the card at PayFast so the next entry is one tap.
          saveCard: !savedCard && saveCard,
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

      track('stake_chosen', { tier: selected })
      track('payment_started', { tier: selected })

      // ── 3a. PayFast's modal on this page, when we have an identifier ─────
      if (pfData.onsite?.uuid && pfData.onsite?.engineUrl) {
        try {
          await loadOnsiteEngine(pfData.onsite.engineUrl)
          setStep('paying')
          track('payment_onsite_opened', { tier: selected })
          window.payfast_do_onsite_payment!({ uuid: pfData.onsite.uuid }, completed => {
            if (completed) {
              // The ITN grants the bet; the return page finds it and opens the record screen.
              router.push(`/payment-return?ref=${encodeURIComponent(pfData.m_payment_id)}`)
            } else {
              // Closed without paying. Nothing was charged; the sheet stays open.
              track('payment_onsite_closed', { tier: selected })
              setStep('idle')
            }
          })
          return
        } catch (onsiteErr) {
          // The modal could not open; the hosted page still can.
          console.warn('[PayFast] Onsite unavailable, using the hosted page:', onsiteErr)
        }
      }

      // ── 3b. Build hidden form and submit → redirect to PayFast ────────────
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
            <div className="stake-course">
              <span className="stake-course-text">
                <span className="stake-course-name">{selectedCourse.name}</span>
                <span className="stake-course-meta">Hole {selectedHole.holeNumber} · Par {selectedHole.par} · {selectedHole.distanceMetres}m</span>
              </span>
              <button type="button" className="stake-change" onClick={() => router.push('/select-course')}>Change</button>
            </div>
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
                {tier.winZAR >= 1_000_000 && <span className="stake-flag">Top prize</span>}
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

              {savedCard ? (
                <>
                  <button
                    type="button"
                    className="btn-lime btn-lime--block"
                    onClick={handlePayWithSavedCard}
                    disabled={loading}
                  >
                    <LockIcon />
                    {step === 'paying' ? 'Charging your card…' : `Pay ${formatRand(activeTier.stakeZAR)} with saved card`}
                  </button>
                  <button type="button" className="btn-tile btn-tile--block stake-alt" onClick={handleConfirmPayment} disabled={loading}>
                    {step === 'opening' ? 'Opening PayFast…' : 'Pay another way'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-lime btn-lime--block"
                    onClick={handleConfirmPayment}
                    disabled={loading}
                  >
                    <LockIcon />
                    {step === 'paying' ? 'Complete your payment…' : loading ? 'Opening PayFast…' : `Pay ${formatRand(activeTier.stakeZAR)} & play`}
                  </button>
                  <label className="stake-save">
                    <input type="checkbox" checked={saveCard} onChange={e => setSaveCard(e.target.checked)} disabled={loading} />
                    <span>Save my card with PayFast for one-tap entries next time. You can remove it under Account.</span>
                  </label>
                </>
              )}

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
