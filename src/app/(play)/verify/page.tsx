'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'
import { useBet, BET_TIERS } from '@/context/BetContext'
import { isGolfDayTier, tierByKey } from '@/lib/tiers'
import { formatPrize, formatRand } from '@/lib/format'
import { useUpload } from '@/hooks/useUpload'
import { fetchJson } from '@/lib/net/fetch-json'

type StepStatus = 'completed' | 'active' | 'pending' | 'failed'

interface VerifyStep {
  id: string
  title: string
  desc: string
  status: StepStatus
}

const INITIAL_STEPS: VerifyStep[] = [
  { id: 'footage',   title: 'Footage received',   desc: 'Your video is safely uploaded.',              status: 'active' },
  { id: 'documents', title: 'Documents received', desc: 'Certificate and affidavit are with us.',       status: 'active' },
  { id: 'verified',  title: 'Shot verified',      desc: 'Reviewed by our team and the insurer.',        status: 'pending' },
  { id: 'payout',    title: 'Prize paid',         desc: 'Funds transferred to your account.',           status: 'pending' },
]

const STATUS_TO_STEPS: Record<string, number> = {
  pending: 1,
  documents_received: 2,
  under_review: 2,
  approved: 3,
  rejected: 3,
}

function applyProgress(steps: VerifyStep[], activeIndex: number): VerifyStep[] {
  return steps.map((s, i) => ({
    ...s,
    status: i < activeIndex ? 'completed' : i === activeIndex ? 'active' : 'pending',
  }))
}

/** A rejected claim stops at the verification step, marked as not passed. */
function applyRejection(steps: VerifyStep[]): VerifyStep[] {
  return steps.map((s, i) =>
    i < 2 ? { ...s, status: 'completed' }
    : i === 2 ? { ...s, status: 'failed', title: 'Not verified', desc: 'The evidence didn\u2019t meet the insurer\u2019s bar.' }
    : { ...s, status: 'pending' })
}

/**
 * Verify — "coming back" after a claim, in the V2 system.
 * Header, CLAIM UNDER REVIEW, a green prize card with the amount in lime,
 * the four-step timeline, and a lime button home. Polling behaviour is
 * unchanged.
 */
export default function VerifyPage() {
  const router = useRouter()
  const { selectedTier, prize, prizeCurrency, betId, selectedCourse, selectedHole, resetSession } = useBet()
  const [steps, setSteps] = useState<VerifyStep[]>(INITIAL_STEPS)
  const [rejected, setRejected] = useState(false)
  // The footage may still be leaving the phone. The server's word (the
  // sealed hash) or the upload manager's: either completes the first step.
  const [footageSealed, setFootageSealed] = useState(false)
  const { state: upload } = useUpload(betId)
  const footageIn = footageSealed || upload?.status === 'done'
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const pollIntervalRef = useRef(10_000)
  const errorCountRef = useRef(0)

  // Guard: require an active bet to reach this page
  useEffect(() => {
    if (!betId) {
      router.replace('/home')
    }
  }, [betId, router])

  // tierByKey, not BET_TIERS: a free swing is a real bet with a real prize.
  const tierData = tierByKey(selectedTier) ?? BET_TIERS[1]
  // A golf day's prize is set per golf day, and Get Lucky covers it itself:
  // there is no insurer on that claim, so the screen must not name one.
  const winning = prize !== null ? formatPrize(prize, prizeCurrency) : formatRand(tierData.winZAR)
  const selfCovered = isGolfDayTier(selectedTier)
  const shownSteps = (selfCovered
    ? steps.map(s => s.id !== 'verified' ? s : {
        ...s,
        desc: s.status === 'failed' ? 'The evidence didn\u2019t meet the bar for a verified hole-in-one.' : 'Reviewed by our team.',
      })
    : steps
  ).map(s => s.id !== 'footage' ? s : footageIn
    ? { ...s, status: 'completed' as const, desc: 'Your video is safely uploaded.' }
    : { ...s, status: 'active' as const, desc: 'Still uploading from your phone. Keep the app open when you have signal.' })
  const payoutDate = new Date()
  payoutDate.setDate(payoutDate.getDate() + 7)
  const payoutEta = payoutDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })

  // The claim's state from the server, polled every 10 s (backing off to a
  // minute on a bad link) until it is approved or rejected.
  useEffect(() => {
    if (!betId) return
    let stopped = false

    async function poll() {
      let terminal = false
      try {
        const { data } = await fetchJson<{ verification: { status?: string } | null; footageSealed?: boolean }>(`/api/verifications/${betId}`, { timeoutMs: 12_000, retries: 0, waitForOnlineMs: 0 })
        if (stopped) return
        if (data.footageSealed) setFootageSealed(true)
        const status = data.verification?.status
        if (status) {
          const isRejected = status === 'rejected'
          const activeIndex = STATUS_TO_STEPS[status] ?? 1
          setSteps(prev => (isRejected ? applyRejection(prev) : applyProgress(prev, activeIndex)))
          setRejected(isRejected)
          terminal = status === 'approved' || isRejected
        }
        errorCountRef.current = 0
        pollIntervalRef.current = 10_000
      } catch (err) {
        console.warn('[verify] status poll failed:', err)
        // Exponential backoff: 10s → 20s → 40s → max 60s
        errorCountRef.current += 1
        pollIntervalRef.current = Math.min(10_000 * Math.pow(2, errorCountRef.current), 60_000)
      }
      if (!stopped && !terminal) pollRef.current = setTimeout(poll, pollIntervalRef.current)
    }

    void poll()
    return () => {
      stopped = true
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [betId])

  function handleHome() {
    resetSession()
    router.push('/home')
  }

  if (!betId) return null

  const doneCount = steps.filter(s => s.status === 'completed').length

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="vf-scroll">
          <h1 className="v2-title" style={{ marginBottom: 10 }}>{rejected ? 'Claim\nnot approved' : 'Claim\nunder review'}</h1>
          <p className="vf-sub">
            {rejected
              ? selfCovered
                ? 'Our team couldn\u2019t verify this hole-in-one from the evidence provided.'
                : 'Our team and the insurer couldn\u2019t verify this hole-in-one from the evidence provided.'
              : 'Our team is verifying your hole-in-one. Claims are reviewed within 5 business days and we\u2019ll let you know the moment it\u2019s confirmed.'}
          </p>

          {rejected ? (
            <div className="auth-error" role="alert" style={{ marginBottom: 18 }}>
              If you think this is wrong, or you have more footage or a witness statement, email{' '}
              <a href="mailto:support@getluckygolf.co.za" style={{ fontWeight: 700 }}>support@getluckygolf.co.za</a> and quote your claim.
            </div>
          ) : (
            <div className="vf-prize">
              <div className="vf-prize-label">Pending prize</div>
              <div className="vf-prize-amount">{winning}</div>
              {selectedCourse && selectedHole && (
                <div className="vf-prize-meta">{selectedCourse.name} · Hole {selectedHole.holeNumber}</div>
              )}
              <div className="vf-prize-eta">Expected by {payoutEta}</div>
            </div>
          )}

          <ol className="vf-steps" aria-label={`${doneCount} of ${steps.length} steps complete`}>
            {shownSteps.map((step, i) => (
              <li key={step.id} className={`vf-step is-${step.status}`}>
                <span className="vf-step-dot" aria-hidden>
                  {step.status === 'completed' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
                  ) : step.status === 'failed' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="vf-step-text">
                  <span className="vf-step-title">{step.title}</span>
                  <span className="vf-step-desc">{step.desc}</span>
                </span>
              </li>
            ))}
          </ol>

          <button type="button" className="btn-lime btn-lime--block" onClick={handleHome}>
            Back to home
          </button>
          <p className="legal-contact">
            Questions about your claim? <a href="mailto:support@getluckygolf.co.za">support@getluckygolf.co.za</a>
          </p>
        </div>

        <BottomTabBar active="play" />
      </div>
    </PhoneFrame>
  )
}
