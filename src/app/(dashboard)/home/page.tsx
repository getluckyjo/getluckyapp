'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'
import { useAuth } from '@/context/AuthContext'
import PullToRefresh from '@/components/pwa/PullToRefresh'
import { useRefreshSignal } from '@/hooks/useRefreshSignal'

interface BetRecord {
  id: string
  status: string
  declared_result: string | null
  courses: { id: string; name: string } | null
}

/**
 * Home — "Home Page.png".
 * One full-bleed aerial, one message (1 SHOT, R1 MILLION.), one button.
 * Everything the old home stacked underneath — recent attempts, the club
 * upsell, how-it-works, the profile sheet — now lives on My bets (menu),
 * Club, the menu and Account respectively. The one thing that stays is the
 * claim-under-review notice, because a golfer with money in flight needs
 * to see it the moment they open the app.
 */
export default function HomePage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  // Keyed by user so a sign-out never shows the previous golfer's claim,
  // without an effect having to reset state.
  const [claim, setClaim] = useState<{ userId: string; bet: BetRecord | null } | null>(null)
  const refreshTick = useRefreshSignal()

  const userId = user?.id
  const firstName = (profile?.name ?? user?.user_metadata?.full_name ?? '').split(' ')[0] || null
  const activeClaim = userId && claim?.userId === userId ? claim.bet : null

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    fetch('/api/bets?limit=50')
      .then(r => r.json())
      .then(data => {
        if (cancelled || !data.bets) return
        const bets = data.bets as BetRecord[]
        const found = bets.find(
          b => b.status === 'claimed' ||
            (b.declared_result === 'win' && b.status !== 'paid' && b.status !== 'verified'),
        )
        setClaim({ userId, bet: found ?? null })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [userId, refreshTick])

  return (
    <PhoneFrame statusTheme="light">
      <div className="v2-screen v2-screen--photo">
        <PullToRefresh />
        <Image
          src="/marketing/hero-bg.webp"
          alt=""
          fill
          priority
          sizes="480px"
          className="v2-photo"
          style={{ objectPosition: '58% 100%' }}
        />
        <div
          className="v2-photo-scrim"
          aria-hidden
          style={{ background: 'linear-gradient(180deg, rgba(20,38,25,0.35) 0%, rgba(20,38,25,0.15) 40%, rgba(20,38,25,0.45) 100%)' }}
        />

        <AppHeader tone="dark" />

        <div className="v2-body">
          <div className="v2-hero">
            {firstName && <span className="home-hello">Welcome back, {firstName}</span>}
            <h1 className="v2-title">{'1 Shot,\nR1 Million.'}</h1>
            <p className="v2-sub">
              Choose a PAR 3.{'\n'}
              Bet On Yourself.{'\n'}
              WIN up to <strong>R1 Million!</strong>
            </p>
            <button
              type="button"
              className="btn-lime"
              onClick={() => router.push('/select-course')}
            >
              Play now
            </button>

            {activeClaim && (
              <button
                type="button"
                className="home-claim"
                onClick={() => router.push('/verify')}
              >
                <span className="home-claim-dot" aria-hidden />
                <span>
                  <span className="home-claim-title">Claim under review</span>
                  <span className="home-claim-sub" style={{ display: 'block' }}>
                    {activeClaim.courses?.name ?? 'Your hole-in-one'} · Tap to check status
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>

        <BottomTabBar active="home" />
      </div>
    </PhoneFrame>
  )
}
