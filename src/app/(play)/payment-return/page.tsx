'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import { GolfBallIcon } from '@/components/icons'
import { useBet } from '@/context/BetContext'
import type { Course, Hole, BetTier } from '@/context/BetContext'

interface PendingPayment {
  m_payment_id: string
  tier: BetTier
  courseId: string
  holeId: string
  course: Course
  hole: Hole
}

export default function PaymentReturnPage() {
  const router = useRouter()
  const { selectCourse, selectTier, confirmPayment, setBetId } = useBet()
  const [status, setStatus] = useState<'processing' | 'error'>('processing')
  const [errorMsg, setErrorMsg] = useState('')
  const [waiting, setWaiting] = useState(false)
  const didRun = useRef(false)

  // Polls /api/bets/create until PayFast's ITN has landed. Total wait is capped;
  // beyond that the payment is real but unconfirmed, which is an ops problem, not
  // something the player can fix by waiting longer.
  async function createBetWhenPaymentConfirms(
    payload: { courseId: string; holeId: string; tier: string; m_payment_id: string },
  ): Promise<{ betId: string }> {
    const delaysMs = [0, 1500, 2500, 4000, 6000, 8000, 10000]

    for (let attempt = 0; attempt < delaysMs.length; attempt++) {
      if (delaysMs[attempt]) await new Promise(r => setTimeout(r, delaysMs[attempt]))

      const res = await fetch('/api/bets/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: payload.courseId,
          holeId:   payload.holeId,
          tier:     payload.tier,
          paymentIntentId: payload.m_payment_id,
        }),
      })

      if (res.ok) return res.json()

      const err = await res.json().catch(() => ({ error: 'Unknown error' }))

      if (res.status === 202 && err.code === 'PAYMENT_PENDING') {
        setWaiting(true)
        continue
      }

      console.error('[PaymentReturn] Bet creation failed:', err)
      throw new Error(err.error ?? 'Could not register your bet. Please contact support.')
    }

    throw new Error(
      'Your payment went through, but we could not confirm it in time. ' +
      'Nothing is lost — please contact support with reference ' + payload.m_payment_id + '.',
    )
  }

  useEffect(() => {
    // Prevent double-execution in React strict mode
    if (didRun.current) return
    didRun.current = true

    async function processReturn() {
      try {
        // ── 1. Read saved session from localStorage ─────────────────────────
        const pendingStr = localStorage.getItem('pf_pending')
        if (!pendingStr) {
          setErrorMsg('No pending payment found. You may have already completed this payment.')
          setStatus('error')
          return
        }

        const pending: PendingPayment = JSON.parse(pendingStr)
        const { m_payment_id, tier, courseId, holeId, course, hole } = pending

        // ── 2. Restore BetContext state (lost during redirect) ──────────────
        selectCourse(course, hole)
        selectTier(tier)
        confirmPayment(m_payment_id)

        // ── 3. Create the bet, once the payment is confirmed ────────────────
        // The server only grants a bet after PayFast's ITN has verified the
        // payment. That notification frequently arrives after the browser gets
        // back here, so a 202 PAYMENT_PENDING is normal — poll rather than fail.
        const bet = await createBetWhenPaymentConfirms({ courseId, holeId, tier, m_payment_id })
        setBetId(bet.betId)

        // ── 4. Clean up and redirect to record page ─────────────────────────
        localStorage.removeItem('pf_pending')
        router.replace('/record')

      } catch (err) {
        console.error('[PaymentReturn] Error:', err)
        const msg = err instanceof Error ? err.message : 'Something went wrong'
        setErrorMsg(msg)
        setStatus('error')
      }
    }

    processReturn()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="v2-body" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}>
          <div className="v2-hero">
            {status === 'processing' ? (
              <>
                <span className="pr-spinner" aria-hidden>
                  <GolfBallIcon size={40} />
                </span>
                <h1 className="v2-title" aria-live="polite">
                  {waiting ? 'Confirming\nyour payment' : 'Setting up\nyour shot'}
                </h1>
                <p className="v2-sub">
                  {waiting
                    ? 'Waiting for PayFast to confirm. This usually takes a few seconds. Please keep this page open.'
                    : 'Payment received. Preparing your challenge\u2026'}
                </p>
              </>
            ) : (
              <>
                <h1 className="v2-title">{'Something\nwent wrong'}</h1>
                <p className="v2-sub" style={{ fontSize: 'var(--text-md)' }}>{errorMsg}</p>
                <div className="miss-actions">
                  <button type="button" className="btn-lime" onClick={() => router.push('/choose-stake')}>
                    Try again
                  </button>
                  <button type="button" className="btn-tile" onClick={() => router.push('/home')}>
                    Back to home
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </PhoneFrame>
  )
}
