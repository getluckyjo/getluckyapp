'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import { track } from '@/lib/analytics'
import { haptics } from '@/lib/haptics'
import AppHeader from '@/components/layout/AppHeader'
import { useBet, BET_TIERS } from '@/context/BetContext'
import { tierByKey } from '@/lib/tiers'
import { useAuth } from '@/context/AuthContext'
import { createClient } from '@/lib/supabase/client'
import { useShareVideo } from '@/hooks/useShareVideo'
import { WitnessSchema, type WitnessInput } from '@/lib/claims/witnesses'

type WitnessDraft = { role: WitnessInput['role']; name: string; email: string }
const EMPTY_WITNESSES: WitnessDraft[] = [
  { role: 'witness', name: '', email: '' },
  { role: 'witness', name: '', email: '' },
  { role: 'club_official', name: '', email: '' },
]

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
  const { betId, resetSession, videoBlob, selectedTier, prizeZAR, selectedCourse, selectedHole } = useBet()
  const { user } = useAuth()
  // tierByKey, not BET_TIERS: a free swing is a real bet with a real prize.
  const tierData = tierByKey(selectedTier) ?? BET_TIERS[1]
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
          // Storage policy: a user may only write under their own folder, and
          // never overwrite. A fresh name per attempt keeps retries working.
          const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'document'
          const path = `${user?.id ?? 'anonymous'}/${betId ?? 'mock'}/${stepId}/${Date.now()}-${safeName}`
          const { data, error } = await supabase.storage
            .from('verification-docs')
            .upload(path, file, { upsert: false })
          if (error) console.error('[claim] Upload rejected:', error.message)
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

  // Who saw it. A row counts once both fields parse; the first playing
  // partner is required, the rest are optional. Same schema as the server.
  const [witnesses, setWitnesses] = useState<WitnessDraft[]>(EMPTY_WITNESSES)
  const [witnessError, setWitnessError] = useState<string | null>(null)
  const filledWitnesses = witnesses.filter(w => w.name.trim() || w.email.trim())
  const parsedWitnesses = filledWitnesses.map(w => WitnessSchema.safeParse(w))
  const witnessesValid = parsedWitnesses.every(r => r.success)
  const hasPartner = parsedWitnesses.some(r => r.success && r.data.role === 'witness')
  const canSubmit = allDone && witnessesValid && hasPartner && !loading

  function updateWitness(i: number, field: 'name' | 'email', value: string) {
    setWitnessError(null)
    setWitnesses(prev => prev.map((w, idx) => (idx === i ? { ...w, [field]: value } : w)))
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setLoading(true)

    const certificateStep = steps.find(s => s.id === 'certificate')
    const affidavitStep = steps.find(s => s.id === 'affidavit')

    try {
      const res = await fetch(`/api/verifications/${betId ?? 'mock'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          certificatePath: certificateStep?.storagePath ?? null,
          affidavitPath: affidavitStep?.storagePath ?? null,
          witnesses: parsedWitnesses.flatMap(r => (r.success ? [r.data] : [])),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; code?: string }
        if (body.code === 'DOCUMENT_MISSING') {
          // The browser-side upload did not land. Let them upload again.
          setSteps(prev => prev.map(s => (s.id === 'video' ? s : { ...s, done: false, storagePath: undefined, fileName: undefined })))
        }
        setWitnessError(body.error ?? 'Your claim could not be submitted. Please try again.')
        setLoading(false)
        return
      }
    } catch {
      setWitnessError('Your claim could not be submitted. Please check your connection and try again.')
      setLoading(false)
      return
    }

    setLoading(false)
    haptics.success()
    track('claim_submitted')
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
              <div className="vf-prize-amount">R{(prizeZAR ?? tierData.winZAR).toLocaleString('en-ZA').replace(/,/g, ' ')}</div>
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

          <section className="acct-card" style={{ marginTop: 16 }}>
            <header className="acct-card-head"><h2>Who saw it</h2></header>
            <p className="acct-row-sub" style={{ display: 'block', margin: '0 0 12px' }}>
              We will ask them to confirm. At least one playing partner is needed; the club official who signed your certificate helps your claim move faster.
            </p>
            <div className="acct-form">
              {witnesses.map((w, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label className="acct-field" style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
                    <span>{w.role === 'club_official' ? 'Club official (optional)' : i === 0 ? 'Playing partner' : 'Playing partner (optional)'}</span>
                    <input className="acct-input" value={w.name} onChange={e => updateWitness(i, 'name', e.target.value)} placeholder="Full name" autoComplete="off" />
                  </label>
                  <div className="acct-field" style={{ gridColumn: '1 / -1' }}>
                    <input className="acct-input" type="email" inputMode="email" aria-label="Email address" value={w.email} onChange={e => updateWitness(i, 'email', e.target.value)} placeholder="Email address" autoComplete="off" />
                  </div>
                </div>
              ))}
            </div>
            {!witnessesValid && <p className="acct-row-sub" style={{ display: 'block', color: '#c0392b' }}>Each person needs a full name and a valid email address.</p>}
            {witnessError && <p className="acct-row-sub" style={{ display: 'block', color: '#c0392b' }} role="alert">{witnessError}</p>}
          </section>

          <div className="cf-actions">
            <button
              type="button"
              className="btn-lime btn-lime--block"
              onClick={handleSubmit}
              disabled={!canSubmit}
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
