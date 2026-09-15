'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import { useBet } from '@/context/BetContext'

/**
 * Confirm — "Did it go in?" in the V2 system.
 * The replay in a rounded card with the save-status chip on it, then the
 * honest question: a lime YES and a quiet NOT THIS TIME. No tab bar; this
 * is a decision, not a place to wander off from.
 */
export default function ConfirmPage() {
  const router = useRouter()
  const { videoBlob, betId, declareResult, uploadStatus, uploadProgress, startBackgroundUpload } = useBet()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [analysing, setAnalysing] = useState(true)

  const hasVideo = !!(videoBlob && videoBlob.size > 0)

  // One object URL per blob, released when the blob changes or we leave.
  const videoUrl = useMemo(() => (hasVideo && videoBlob ? URL.createObjectURL(videoBlob) : null), [videoBlob, hasVideo])
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])

  // Guard: require a recorded video to reach this page
  useEffect(() => {
    if (!hasVideo) {
      router.replace('/home')
    }
  }, [hasVideo, router])

  // Footage check (server-side, non-blocking for the golfer's declaration)
  useEffect(() => {
    async function runVerification() {
      try {
        await fetch('/api/videos/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ betId: betId ?? 'mock', storagePath: null }),
        })
      } catch {
        // Non-critical
      }
      setAnalysing(false)
    }
    runVerification()
  }, [betId])

  function handleHoleInOne() {
    declareResult('hole_in_one')
    router.push('/result/claim')
  }

  function handleMiss() {
    declareResult('miss')
    router.push('/result/miss')
  }

  if (!hasVideo) return null

  const saveChip =
    uploadStatus === 'uploading' ? { tone: 'busy', label: `Saving video · ${uploadProgress}%` } :
    uploadStatus === 'error'     ? { tone: 'error', label: 'Video not saved. Tap to retry' } :
    uploadStatus === 'done'      ? { tone: 'ok', label: 'Video saved' } :
    null

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="vf-scroll" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}>
          <h1 className="v2-title" style={{ marginBottom: 8 }}>{'Did it\ngo in?'}</h1>
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

            {saveChip && (
              <button
                type="button"
                className={`cf-chip cf-chip--${saveChip.tone}`}
                disabled={saveChip.tone !== 'error'}
                onClick={() => {
                  if (saveChip.tone === 'error' && videoBlob && betId) {
                    startBackgroundUpload(videoBlob, videoBlob.type || 'video/webm', betId)
                  }
                }}
              >
                {saveChip.tone === 'busy' && <span className="cf-spinner" aria-hidden />}
                {saveChip.label}
              </button>
            )}
            <span className={`cf-chip cf-chip--right${analysing ? ' cf-chip--busy' : ' cf-chip--ok'}`}>
              {analysing && <span className="cf-spinner" aria-hidden />}
              {analysing ? 'Checking footage' : 'Footage received'}
            </span>
          </div>

          <div className="cf-actions">
            <button
              type="button"
              className="btn-lime btn-lime--block"
              onClick={handleHoleInOne}
              disabled={analysing}
            >
              Yes, it went in!
            </button>
            <button type="button" className="btn-tile btn-tile--block" onClick={handleMiss}>
              Not this time
            </button>
          </div>

          <p className="cf-note">
            Your honest declaration is the first step. A claim needs this footage, the course certificate and a 4-ball affidavit.
          </p>
        </div>
      </div>
    </PhoneFrame>
  )
}
