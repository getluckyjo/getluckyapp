'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'
import { useBet, BET_TIERS } from '@/context/BetContext'
import { isNoStakeTier, tierByKey } from '@/lib/tiers'
import { useAuth } from '@/context/AuthContext'
import { useShareVideo } from '@/hooks/useShareVideo'
import { useUpload } from '@/hooks/useUpload'
import { uploadChip } from '@/lib/upload/chip'
import { fetchJson } from '@/lib/net/fetch-json'
import { browserOnline } from '@/lib/net/online'

/**
 * Miss — "Great swing." The coming-back beat, so it takes the same photo
 * treatment as the All Set screen: dark turf, display headline, one lime
 * PLAY AGAIN, share, and the tab bar to move on.
 */
export default function TryAgainPage() {
  const router = useRouter()
  const { selectedTier, betId, resetSession, videoBlob, selectedCourse, selectedHole, hydrated } = useBet()
  const { profile } = useAuth()
  const [toast, setToast] = useState<string | null>(null)
  const { state: upload, retry: retryUpload } = useUpload(betId)
  const chip = uploadChip(upload)
  // Whether the server has the result. Off the grid it is told when the
  // signal returns; the footage upload carries on regardless.
  const [resultSaved, setResultSaved] = useState<'pending' | 'saved' | 'later'>('pending')

  // Guard: require an active bet session (after the phone's stored footage has been checked)
  useEffect(() => {
    if (hydrated && !betId) {
      router.replace('/home')
    }
  }, [hydrated, betId, router])

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

  // Record the miss. The server is idempotent (a repeat is 200 alreadyDone),
  // so the request may retry across a flaky link; when it still cannot get
  // through, the next 'online' tries once more.
  useEffect(() => {
    if (!betId) return
    let cancelled = false
    let unsub = () => {}
    const save = async () => {
      try {
        await fetchJson(`/api/bets/${betId}`, { method: 'PATCH', body: { status: 'miss', declared_result: 'miss' }, retries: 4, backoffMs: [1_000, 3_000, 8_000, 20_000], timeoutMs: 12_000 })
        if (!cancelled) setResultSaved('saved')
      } catch {
        if (cancelled) return
        setResultSaved('later')
        unsub = browserOnline.subscribe(online => { if (online) { unsub(); void save() } })
      }
    }
    void save()
    return () => { cancelled = true; unsub() }
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

  // tierByKey, not BET_TIERS: a free swing is a real bet with a real prize.
  const tierData = tierByKey(selectedTier) ?? BET_TIERS[1]
  // After a free or promo swing there is no stake to repeat, so the button
  // points at the cheapest paid entry — this is the moment the try converts.
  const stakeLabel = isNoStakeTier(selectedTier)
    ? `from R${BET_TIERS[0].stakeZAR}`
    : `R${tierData.stakeZAR.toLocaleString('en-ZA').replace(/,/g, ' ')}`
  const totalAttempts = profile?.total_attempts ?? 0

  if (!betId) return null

  return (
    <PhoneFrame statusTheme="light">
      <div className="v2-screen v2-screen--photo">
        <Image
          src="/marketing/courses/zimbali.jpg"
          alt=""
          fill
          sizes="100vw"
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
            {(chip.tone !== 'ok' || resultSaved === 'later') && (
              <button type="button" className={`cf-chip cf-chip--${chip.tone}`} style={{ marginTop: 10 }} disabled={!chip.retry} onClick={() => { if (chip.retry) retryUpload() }} aria-live="polite">
                {chip.spinner && <span className="cf-spinner" aria-hidden />}
                {chip.tone === 'ok' ? 'We\u2019ll record your result when you\u2019re back online' : chip.label}
              </button>
            )}

            <div className="miss-actions">
              <button type="button" className="btn-lime" onClick={handlePlayAgain}>
                Play again · {stakeLabel}
              </button>
              <button type="button" className="btn-tile" onClick={handleShareShot} disabled={isSharing}>
                {isSharing ? 'Sharing…' : hasVideo ? 'Share my shot' : 'Share my attempt'}
              </button>
              <button type="button" className="miss-link" onClick={() => { resetSession(); router.push('/history') }}>
                See all my shots
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
