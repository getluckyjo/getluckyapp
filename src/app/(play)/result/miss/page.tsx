'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'
import { useBet, BET_TIERS } from '@/context/BetContext'
import { useAuth } from '@/context/AuthContext'
import { useShareVideo } from '@/hooks/useShareVideo'

/**
 * Miss — "Great swing." The coming-back beat, so it takes the same photo
 * treatment as the All Set screen: dark turf, display headline, one lime
 * PLAY AGAIN, share, and the tab bar to move on.
 */
export default function TryAgainPage() {
  const router = useRouter()
  const { selectedTier, betId, resetSession, videoBlob, selectedCourse, selectedHole } = useBet()
  const { profile } = useAuth()
  const [toast, setToast] = useState<string | null>(null)

  // Guard: require an active bet session
  useEffect(() => {
    if (!betId) {
      router.replace('/home')
    }
  }, [betId, router])

  const {
    canShareFiles,
    canShareText,
    hasVideo,
    isSharing,
    shareWithVideo,
    shareTextOnly,
    downloadVideo,
  } = useShareVideo({
    videoBlob,
    title: 'My hole-in-one attempt on Get Lucky Golf!',
    text: 'I just took a hole-in-one challenge on Get Lucky Golf 🏌️‍♂️⛳ — next one is going in!',
  })

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  useEffect(() => {
    if (!betId || betId.startsWith('bet_mock') || betId.startsWith('bet_fallback')) return
    fetch(`/api/bets/${betId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'miss', declared_result: 'miss' }),
    }).catch(() => {})
  }, [betId])

  function handlePlayAgain() {
    resetSession()
    router.push('/select-course')
  }

  async function handleShareShot() {
    if (hasVideo && canShareFiles) {
      const ok = await shareWithVideo()
      if (ok) return
      // Video share failed at OS level — fall back to text
    }
    if (canShareText) {
      await shareTextOnly()
    } else if (hasVideo) {
      downloadVideo()
      showToast('Video saved! Share it from your gallery')
    } else {
      showToast('Sharing not supported on this browser')
    }
  }

  const tierData = BET_TIERS.find(t => t.tier === selectedTier) ?? BET_TIERS[1]
  const stakeLabel = `R${tierData.stakeZAR.toLocaleString('en-ZA').replace(/,/g, ' ')}`
  const totalAttempts = profile?.total_attempts ?? 0

  if (!betId) return null

  return (
    <PhoneFrame statusTheme="light">
      <div className="v2-screen v2-screen--photo">
        <Image
          src="/marketing/courses/zimbali.jpg"
          alt=""
          fill
          priority
          sizes="480px"
          className="v2-photo"
          style={{ objectPosition: '62% 100%' }}
        />
        <div
          className="v2-photo-scrim"
          aria-hidden
          style={{ background: 'linear-gradient(180deg, rgba(20,38,25,0.6) 0%, rgba(20,38,25,0.4) 45%, rgba(20,38,25,0.7) 100%)' }}
        />

        <AppHeader tone="dark" />

        <div className="v2-body">
          <div className="v2-hero">
            {(totalAttempts > 0 || selectedHole) && (
              <div className="miss-pills">
                {totalAttempts > 0 && <span className="miss-attempt">Attempt {totalAttempts}</span>}
                {selectedCourse && selectedHole && (
                  <span className="miss-attempt miss-attempt--hole">{selectedCourse.name} · Hole {selectedHole.holeNumber}</span>
                )}
              </div>
            )}
            <h1 className="v2-title">{'Great\nswing.'}</h1>
            <p className="v2-sub">The ace is coming.{'\n'}It&apos;s just a matter of time.</p>

            <div className="miss-actions">
              <button type="button" className="btn-lime" onClick={handlePlayAgain}>
                Play again · {stakeLabel}
              </button>
              <button type="button" className="btn-tile" onClick={handleShareShot} disabled={isSharing}>
                {isSharing ? 'Sharing…' : hasVideo ? 'Share my shot' : 'Share my attempt'}
              </button>
              <button type="button" className="miss-link" onClick={() => { resetSession(); router.push('/history') }}>
                See all my bets
              </button>
            </div>
          </div>
        </div>

        <BottomTabBar active="play" />
      </div>

      {toast && (
        <div className="toast" role="status" aria-live="polite" style={{ bottom: 'calc(var(--tab-bar-h) + 10px)', zIndex: 200 }}>
          {toast}
        </div>
      )}
    </PhoneFrame>
  )
}
