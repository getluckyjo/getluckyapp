'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import { track } from '@/lib/analytics'
import { haptics } from '@/lib/haptics'
import AppHeader from '@/components/layout/AppHeader'
import { GolfBallIcon } from '@/components/icons'
import { useBet, BET_TIERS } from '@/context/BetContext'
import type { Course, Hole, BetTier } from '@/context/BetContext'

/** PayFast's confirmation never arrived within the polling window. */
class PaymentTimeout extends Error {
  constructor(public reference: string) {
    super('Payment not confirmed in time')
  }
}

/** This browser has no session: the golfer must sign in to finish. */
class SignInNeeded extends Error {
  constructor(public reference: string) {
    super('Sign in to finish setting up your shot')
  }
}

interface ApiBet {
  id: string
  tier: BetTier
  courses: { id: string; name: string; location_text: string | null; region: string | null } | null
  holes: { id: string; hole_number: number; par: number; distance_metres: number | null } | null
}

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
  const [errorKind, setErrorKind] = useState<'none' | 'timeout' | 'failed' | 'signin'>('failed')
  const [reference, setReference] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [pending, setPending] = useState<PendingPayment | null>(null)
  const [copied, setCopied] = useState(false)
  const didRun = useRef(false)

  // Polls /api/bets/create until PayFast's ITN has landed. Total wait is capped;
  // beyond that the payment is real but unconfirmed, which is an ops problem, not
  // something the player can fix by waiting longer.
  async function createBetWhenPaymentConfirms(
    payload: { courseId?: string; holeId?: string; tier?: string; m_payment_id: string },
  ): Promise<{ betId: string }> {
    const delaysMs = [0, 1500, 2500, 4000, 6000, 8000, 10000]

    for (let attempt = 0; attempt < delaysMs.length; attempt++) {
      if (delaysMs[attempt]) await new Promise(r => setTimeout(r, delaysMs[attempt]))

      // Course, hole and tier are advisory; the server builds the bet from
      // the ledger row the reference names. Send them only when known.
      const res = await fetch('/api/bets/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentIntentId: payload.m_payment_id,
          ...(payload.courseId ? { courseId: payload.courseId } : {}),
          ...(payload.holeId   ? { holeId:   payload.holeId }   : {}),
          ...(payload.tier     ? { tier:     payload.tier }     : {}),
        }),
      })

      // 202 is inside the "ok" range, so it has to be checked before res.ok
      // or a pending payment would be treated as a created bet.
      if (res.status === 202) {
        setWaiting(true)
        continue
      }

      if (res.ok) return res.json()

      if (res.status === 401) throw new SignInNeeded(payload.m_payment_id)

      const err = await res.json().catch(() => ({ error: 'Unknown error' }))

      console.error('[PaymentReturn] Bet creation failed:', err)
      throw new Error(err.error ?? 'Could not register your shot. Please contact support.')
    }

    throw new PaymentTimeout(payload.m_payment_id)
  }

  useEffect(() => {
    // Prevent double-execution in React strict mode
    if (didRun.current) return
    didRun.current = true

    async function processReturn() {
      try {
        // ── 1. Which payment? ───────────────────────────────────────────────
        // The stake screen saves a note in localStorage before handing over to
        // PayFast, and PayFast's return URL carries the reference. Either is
        // enough. The note can be missing when the browser that comes back is
        // not the one that left (an installed iOS app opens PayFast in an
        // in-app browser with its own storage), so the URL wins on conflict.
        const params = new URLSearchParams(window.location.search)
        const refFromUrl = params.get('ref') ?? params.get('m_payment_id')
        let saved: PendingPayment | null = null
        try {
          const pendingStr = localStorage.getItem('pf_pending')
          saved = pendingStr ? (JSON.parse(pendingStr) as PendingPayment) : null
        } catch { saved = null }
        if (saved && refFromUrl && saved.m_payment_id !== refFromUrl) saved = null

        if (!saved && !refFromUrl) {
          setErrorKind('none')
          setStatus('error')
          return
        }

        const m_payment_id = saved?.m_payment_id ?? (refFromUrl as string)
        setReference(m_payment_id)

        // ── 2. Restore BetContext state (lost during redirect) ──────────────
        if (saved) {
          setPending(saved)
          selectCourse(saved.course, saved.hole)
          selectTier(saved.tier)
        }
        confirmPayment(m_payment_id)

        // ── 3. Create the bet, once the payment is confirmed ────────────────
        // The server only grants a bet after PayFast's ITN has verified the
        // payment. That notification frequently arrives after the browser gets
        // back here, so a 202 PAYMENT_PENDING is normal — poll rather than fail.
        const bet = await createBetWhenPaymentConfirms({
          m_payment_id,
          courseId: saved?.courseId,
          holeId: saved?.holeId,
          tier: saved?.tier,
        })
        setBetId(bet.betId)

        // Without the note, the record screen still needs the course and hole:
        // read them back from the bet the server just made (or already had).
        let tier: BetTier | undefined = saved?.tier
        if (!saved) {
          const res = await fetch('/api/bets?limit=50')
          const data = res.ok ? await res.json() : { bets: [] }
          const row = (data.bets as ApiBet[] | undefined)?.find(b => b.id === bet.betId)
          if (row?.courses && row?.holes) {
            selectCourse(
              { id: row.courses.id, name: row.courses.name, location: row.courses.location_text ?? row.courses.region ?? '', region: row.courses.region ?? '', emoji: '⛳' },
              { id: row.holes.id, courseId: row.courses.id, holeNumber: row.holes.hole_number, par: row.holes.par, distanceMetres: row.holes.distance_metres ?? 0 },
            )
            selectTier(row.tier)
            tier = row.tier
          }
        }

        // ── 4. Clean up and redirect to record page ─────────────────────────
        try { localStorage.removeItem('pf_pending') } catch { /* storage unavailable */ }
        haptics.success()
        track('bet_created', { tier: tier ?? 'unknown' })
        router.replace('/record')

      } catch (err) {
        console.error('[PaymentReturn] Error:', err)
        if (err instanceof SignInNeeded) {
          // This browser has no session. Usually it is the in-app browser an
          // installed iOS app opened for PayFast: the bet already exists (the
          // ITN granted it) and the golfer's app shows it on Home. Say so
          // rather than pushing a sign-in into the wrong browser.
          setErrorKind('signin')
          setStatus('error')
          return
        }
        if (err instanceof PaymentTimeout) {
          setErrorKind('timeout')
        } else {
          setErrorKind('failed')
          setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
        }
        setStatus('error')
      }
    }

    processReturn()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tierData = pending ? BET_TIERS.find(t => t.tier === pending.tier) : undefined
  const supportHref = `mailto:support@getluckygolf.co.za?subject=${encodeURIComponent(`Payment ${reference} not confirmed`)}&body=${encodeURIComponent(`Hi Get Lucky,\n\nI paid for a shot but the app couldn't confirm it.\n\nPayment reference: ${reference}\nCourse: ${pending?.course.name ?? ''}\nHole: ${pending?.hole.holeNumber ?? ''}\n\nThanks`)}`

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(reference)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable — the reference is still on screen */ }
  }

  const steps = [
    { title: 'Payment sent',         state: 'completed' },
    { title: 'Confirmed by PayFast', state: waiting ? 'active' : 'completed' },
    { title: 'Ready to record',      state: waiting ? 'pending' : 'active' },
  ]

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

                {pending && (
                  <div className="stake-course pr-order">
                    <span className="stake-course-text">
                      <span className="stake-course-name">{pending.course.name}</span>
                      <span className="stake-course-meta">
                        Hole {pending.hole.holeNumber} · {pending.hole.distanceMetres}m
                        {tierData && <> · R{tierData.stakeZAR.toLocaleString('en-ZA').replace(/,/g, ' ')} stake</>}
                      </span>
                    </span>
                  </div>
                )}

                <ol className="pr-steps" aria-label="Payment progress">
                  {steps.map(step => (
                    <li key={step.title} className={`pr-step is-${step.state}`}>
                      <span className="pr-step-dot" aria-hidden>
                        {step.state === 'completed' && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
                        )}
                      </span>
                      {step.title}
                    </li>
                  ))}
                </ol>
              </>
            ) : errorKind === 'none' ? (
              <>
                <h1 className="v2-title">{'Nothing to\nfinish here'}</h1>
                <p className="v2-sub" style={{ fontSize: 'var(--text-md)' }}>
                  No payment is waiting on this device. If you&apos;ve just paid, your shot is already set up and sits under My bets.
                </p>
                <div className="miss-actions">
                  <button type="button" className="btn-lime" onClick={() => router.push('/select-course')}>
                    Play now
                  </button>
                  <button type="button" className="btn-tile" onClick={() => router.push('/history')}>
                    My shots
                  </button>
                </div>
              </>
            ) : errorKind === 'signin' ? (
              <>
                <h1 className="v2-title">{'Paid.\nNow open the app'}</h1>
                <p className="v2-sub" style={{ fontSize: 'var(--text-md)' }}>
                  Your shot is set up. This window isn&apos;t signed in, so close it and open Get Lucky from your home screen: your shot is waiting on Home, ready to record.
                </p>
                <p className="pr-note">Not using the home-screen app? Sign in here instead.</p>
                <div className="miss-actions">
                  <button type="button" className="btn-lime" onClick={() => router.push('/home')}>
                    Open Home
                  </button>
                  <button type="button" className="btn-tile" onClick={() => router.push(`/auth?next=${encodeURIComponent(`/payment-return?ref=${reference}`)}`)}>
                    Sign in here
                  </button>
                </div>
              </>
            ) : errorKind === 'timeout' ? (
              <>
                <h1 className="v2-title">{'Paid, but not\nconfirmed yet'}</h1>
                <p className="v2-sub" style={{ fontSize: 'var(--text-md)' }}>
                  Your payment went through, but PayFast hasn&apos;t confirmed it to us in time. Nothing is lost. Send us the reference and we&apos;ll set your shot up.
                </p>
                <button type="button" className="pr-ref" onClick={copyReference} aria-label={`Copy reference ${reference}`}>
                  <span className="pr-ref-label">Reference</span>
                  <span className="pr-ref-code">{reference}</span>
                  <span className="pr-ref-copy">{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <div className="miss-actions">
                  <a href={supportHref} className="btn-lime">Email support</a>
                  <button type="button" className="btn-tile" onClick={() => router.push('/home')}>
                    Back to home
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="v2-title">{'Something\nwent wrong'}</h1>
                <p className="v2-sub" style={{ fontSize: 'var(--text-md)' }}>{errorMsg}</p>
                {reference && <p className="pr-note">Payment reference {reference}</p>}
                <div className="miss-actions">
                  <button type="button" className="btn-lime" onClick={() => router.push('/select-course')}>
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
