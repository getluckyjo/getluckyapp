'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'
import { useBet, BET_TIERS } from '@/context/BetContext'

type StepStatus = 'completed' | 'active' | 'pending'

interface VerifyStep {
  id: string
  title: string
  desc: string
  status: StepStatus
}

const INITIAL_STEPS: VerifyStep[] = [
  { id: 'footage',   title: 'Footage received',   desc: 'Your video is safely uploaded.',              status: 'completed' },
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

/**
 * Verify — "coming back" after a claim, in the V2 system.
 * Header, CLAIM UNDER REVIEW, a green prize card with the amount in lime,
 * the four-step timeline, and a lime button home. Polling behaviour is
 * unchanged.
 */
export default function VerifyPage() {
  const router = useRouter()
  const { selectedTier, betId, resetSession } = useBet()
  const [steps, setSteps] = useState<VerifyStep[]>(INITIAL_STEPS)
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const pollIntervalRef = useRef(10_000)
  const errorCountRef = useRef(0)

  // Guard: require an active bet to reach this page
  useEffect(() => {
    if (!betId) {
      router.replace('/home')
    }
  }, [betId, router])

  const tierData = BET_TIERS.find(t => t.tier === selectedTier) ?? BET_TIERS[1]
  const payoutDate = new Date()
  payoutDate.setDate(payoutDate.getDate() + 7)
  const payoutEta = payoutDate.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })

  // Simulated progression (fallback / demo)
  useEffect(() => {
    const t1 = setTimeout(() => {
      setSteps(prev => applyProgress(prev, 2))
    }, 5000)
    return () => clearTimeout(t1)
  }, [])

  // Real polling from Supabase (when betId is real)
  useEffect(() => {
    if (!betId || betId.startsWith('bet_mock') || betId.startsWith('bet_fallback')) return

    async function poll() {
      try {
        const res = await fetch(`/api/verifications/${betId}`)
        if (!res.ok) throw new Error('poll failed')
        const { verification } = await res.json()
        if (verification?.status) {
          const activeIndex = STATUS_TO_STEPS[verification.status] ?? 1
          setSteps(prev => applyProgress(prev, activeIndex))
        }
        // Reset on success
        errorCountRef.current = 0
        pollIntervalRef.current = 10_000
      } catch {
        // Exponential backoff: 10s → 20s → 40s → max 60s
        errorCountRef.current += 1
        pollIntervalRef.current = Math.min(10_000 * Math.pow(2, errorCountRef.current), 60_000)
      }
      // Schedule next poll with current interval
      pollRef.current = setTimeout(poll, pollIntervalRef.current)
    }

    poll()
    return () => {
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
          <h1 className="v2-title" style={{ marginBottom: 10 }}>{'Claim\nunder review'}</h1>
          <p className="vf-sub">
            Our team is verifying your hole-in-one. We&apos;ll let you know the moment it&apos;s confirmed.
          </p>

          <div className="vf-prize">
            <div className="vf-prize-label">Pending prize</div>
            <div className="vf-prize-amount">R{tierData.winZAR.toLocaleString('en-ZA').replace(/,/g, ' ')}</div>
            <div className="vf-prize-eta">Expected by {payoutEta}</div>
          </div>

          <ol className="vf-steps" aria-label={`${doneCount} of ${steps.length} steps complete`}>
            {steps.map((step, i) => (
              <li key={step.id} className={`vf-step is-${step.status}`}>
                <span className="vf-step-dot" aria-hidden>
                  {step.status === 'completed' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
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
        </div>

        <BottomTabBar active="play" />
      </div>
    </PhoneFrame>
  )
}
