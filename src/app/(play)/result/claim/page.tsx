'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import { useBet, BET_TIERS } from '@/context/BetContext'
import { createClient } from '@/lib/supabase/client'
import { useShareVideo } from '@/hooks/useShareVideo'

interface UploadStep {
  id: string
  title: string
  desc: string
  done: boolean
  uploading?: boolean
  storagePath?: string
  fileName?: string
}

/**
 * Claim — "Incredible shot!" in the V2 system.
 * Three proof cards (video is already in; certificate and affidavit are a
 * tap to upload), then a lime SUBMIT CLAIM, a share tile, and the escape
 * hatch to upload later. Upload and submission behaviour is unchanged.
 */
export default function ClaimPage() {
  const router = useRouter()
  const { betId, resetSession, videoBlob, selectedTier, selectedCourse, selectedHole } = useBet()
  const tierData = BET_TIERS.find(t => t.tier === selectedTier) ?? BET_TIERS[1]
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
    title: 'HOLE-IN-ONE on Get Lucky Golf!',
    text: 'I just hit a HOLE-IN-ONE on Get Lucky Golf! ⛳🏆 Watch the shot!',
  })

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  async function handleShare() {
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

  const [steps, setSteps] = useState<UploadStep[]>([
    { id: 'video',       title: 'Shot video',         desc: 'Your recording is in.',                          done: true },
    { id: 'certificate', title: 'Course certificate', desc: 'The club’s official hole-in-one certificate.', done: false },
    { id: 'affidavit',   title: '4-ball affidavit',   desc: 'Signed by the golfers you played with.',          done: false },
  ])
  const [loading, setLoading] = useState(false)

  async function handleUpload(stepId: string) {
    return new Promise<void>(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*,application/pdf'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) { resolve(); return }

        // File size validation (max 10 MB)
        if (file.size > 10 * 1024 * 1024) {
          showToast('File too large — max 10 MB')
          resolve()
          return
        }

        // Mark step as uploading
        setSteps(prev =>
          prev.map(s => s.id === stepId ? { ...s, uploading: true } : s)
        )

        let storagePath: string | undefined

        // Attempt Supabase Storage upload
        try {
          const supabase = createClient()
          const path = `${betId ?? 'mock'}/${stepId}/${file.name}`
          const { data } = await supabase.storage
            .from('verification-docs')
            .upload(path, file, { upsert: true })
          storagePath = data?.path
        } catch (err) {
          console.error('[claim] Upload failed:', err)
        }

        // Clear uploading state
        setSteps(prev =>
          prev.map(s => s.id === stepId ? { ...s, uploading: false } : s)
        )

        // Only mark done if upload actually succeeded
        if (storagePath) {
          setSteps(prev =>
            prev.map(s => s.id === stepId ? { ...s, done: true, storagePath, fileName: file.name } : s)
          )
        } else {
          showToast('Upload failed — please try again')
        }

        resolve()
      }
      input.oncancel = () => resolve()
      input.click()
    })
  }

  const allDone = steps.every(s => s.done)
  const doneCount = steps.filter(s => s.done).length

  async function handleSubmit() {
    if (!allDone) return
    setLoading(true)

    const certificateStep = steps.find(s => s.id === 'certificate')
    const affidavitStep = steps.find(s => s.id === 'affidavit')

    await fetch(`/api/verifications/${betId ?? 'mock'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        certificatePath: certificateStep?.storagePath ?? null,
        affidavitPath: affidavitStep?.storagePath ?? null,
      }),
    }).catch(() => {})

    setLoading(false)
    router.push('/verify')
  }

  if (!betId) return null

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="vf-scroll" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}>
          <h1 className="v2-title" style={{ marginBottom: 8 }}>{'Incredible\nshot!'}</h1>
          <p className="vf-sub">
            Upload your proof and we&apos;ll get your prize moving. Claims are reviewed within 5 business days.
          </p>

          <div className="vf-prize cl-prize">
            <div>
              <div className="vf-prize-label">Pending prize</div>
              <div className="vf-prize-amount">R{tierData.winZAR.toLocaleString('en-ZA').replace(/,/g, ' ')}</div>
            </div>
            {selectedCourse && selectedHole && (
              <div className="vf-prize-meta">{selectedCourse.name} · Hole {selectedHole.holeNumber} · {selectedHole.distanceMetres}m</div>
            )}
          </div>

          <div className="cl-progress" aria-label={`${doneCount} of ${steps.length} uploaded`}>
            <span className="cl-progress-text">{doneCount} of {steps.length} in</span>
            <span className="step-bar step-bar--light" aria-hidden>
              {steps.map(s => <span key={s.id} className={s.done ? 'is-on' : undefined} />)}
            </span>
          </div>

          <ul className="cl-steps">
            {steps.map((step, i) => {
              const actionable = !step.done && !step.uploading
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    className={`cl-step${step.done ? ' is-done' : ''}${step.uploading ? ' is-uploading' : ''}`}
                    onClick={() => actionable && handleUpload(step.id)}
                    disabled={!actionable}
                    aria-label={step.done ? `${step.title}: uploaded` : `Upload ${step.title}`}
                  >
                    <span className="vf-step-dot" aria-hidden>
                      {step.uploading ? (
                        <span className="cf-spinner cf-spinner--green" />
                      ) : step.done ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span className="cl-step-text">
                      <span className="cl-step-title">{step.title}</span>
                      <span className="cl-step-desc">{step.uploading ? 'Uploading…' : step.done && step.fileName ? `Uploaded · ${step.fileName}` : step.desc}</span>
                    </span>
                    {actionable && <span className="cl-step-cta">Upload</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="cl-hint">Photo, scan or PDF. Up to 10 MB each.</p>

          <div className="cf-actions">
            <button
              type="button"
              className="btn-lime btn-lime--block"
              onClick={handleSubmit}
              disabled={!allDone || loading}
            >
              {loading ? 'Submitting…' : 'Submit claim'}
            </button>
            <button type="button" className="btn-tile btn-tile--block" onClick={handleShare} disabled={isSharing}>
              {isSharing ? 'Sharing…' : 'Share my hole-in-one'}
            </button>
          </div>

          <button
            type="button"
            className="cl-later"
            onClick={() => { resetSession(); router.push('/home') }}
          >
            I&apos;ll upload the documents later
          </button>
          <p className="cf-note">You have 7 days from the date of your shot to submit.</p>
        </div>
      </div>

      {toast && (
        <div className="toast" role="status" aria-live="polite" style={{ bottom: 40, zIndex: 200 }}>
          {toast}
        </div>
      )}
    </PhoneFrame>
  )
}
