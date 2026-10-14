'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import { track } from '@/lib/analytics'
import { haptics } from '@/lib/haptics'
import AppHeader from '@/components/layout/AppHeader'
import { useBet } from '@/context/BetContext'
import { useUpload } from '@/hooks/useUpload'
import { uploadChip } from '@/lib/upload/chip'

/**
 * Confirm — "Did it go in?" in the V2 system.
 * The replay in a rounded card with the save-status chip on it, then the
 * honest question: a lime YES and a quiet NOT THIS TIME. No tab bar; this
 * is a decision, not a place to wander off from.
 */
export default function ConfirmPage() {
  const router = useRouter()
  const { videoBlob, betId, selectedCourse, selectedHole, declareResult, hydrated } = useBet()
  const { state: upload, retry } = useUpload(betId)
  const videoRef = useRef<HTMLVideoElement>(null)

  const hasVideo = !!(videoBlob && videoBlob.size > 0)

  // One object URL per blob, released when the blob changes or we leave.
  const videoUrl = useMemo(() => (hasVideo && videoBlob ? URL.createObjectURL(videoBlob) : null), [videoBlob, hasVideo])
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])

  // Guard: require a recorded video to reach this page. After a reload the
  // phone's stored copy comes back a moment later, so wait for that check.
  useEffect(() => {
    if (hydrated && !hasVideo) {
      router.replace('/home')
    }
  }, [hydrated, hasVideo, router])

  function handleHoleInOne() {
    declareResult('hole_in_one')
    haptics.success()
    track('result_declared', { result: 'hole_in_one' })
    router.push('/result/claim')
  }

  function handleMiss() {
    declareResult('miss')
    haptics.tap()
    track('result_declared', { result: 'miss' })
    router.push('/result/miss')
  }

  if (!hasVideo) return null

  const saveChip = uploadChip(upload)

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="vf-scroll" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}>
          <h1 className="v2-title" style={{ marginBottom: 8 }}>{'Did it\ngo in?'}</h1>
          {selectedCourse && selectedHole && (
            <p className="cf-meta">{selectedCourse.name} · Hole {selectedHole.holeNumber} · {selectedHole.distanceMetres}m</p>
          )}
          <p className="vf-sub">Watch the replay and tell us straight. A claimed hole-in-one goes through full verification.</p>

          <div className="cf-video">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                autoPlay
                muted
                loop
                playsInline
              />
            ) : (
              <div className="cf-video-empty" />
            )}

            <div className="cf-chips">
              <button
                type="button"
                className={`cf-chip cf-chip--${saveChip.tone}`}
                disabled={!saveChip.retry}
                onClick={() => { if (saveChip.retry) retry() }}
                aria-live="polite"
              >
                {saveChip.spinner && <span className="cf-spinner" aria-hidden />}
                {saveChip.label}
              </button>
            </div>
          </div>

          <div className="cf-actions">
            <button
              type="button"
              className="btn-lime btn-lime--block"
              onClick={handleHoleInOne}
            >
              Yes, it went in!
            </button>
            <button type="button" className="btn-tile btn-tile--block" onClick={handleMiss}>
              Not this time
            </button>
          </div>

          <p className="cf-note">
            Your honest declaration is the first step. A claim needs this footage, the course certificate and a 4-ball affidavit.
            {saveChip.tone !== 'ok' && ' The video stays on your phone and finishes uploading by itself, even with no signal here.'}
          </p>
        </div>
      </div>
    </PhoneFrame>
  )
}
