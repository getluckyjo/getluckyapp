'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import type { CaptureInput } from '@/lib/claims/capture'
import { uploadFootage, xhrPut, type FootageJob } from '@/lib/claims/upload-footage'

// Re-export shared tier definitions so existing client imports keep working
export { BET_TIERS } from '@/lib/tiers'
export type { BetTier, BetTierData } from '@/lib/tiers'
import type { BetTier } from '@/lib/tiers'

export interface Course {
  id: string
  name: string
  location: string
  region: string
  emoji: string
}

export interface Hole {
  id: string
  courseId: string
  holeNumber: number
  par: number
  distanceMetres: number
}

type UploadStatus = 'idle' | 'uploading' | 'done' | 'error'

interface BetSession {
  selectedCourse: Course | null
  selectedHole: Hole | null
  selectedTier: BetTier | null
  /** The prize when it is not the tier's: a golf day swing's, set per golf day. */
  prizeZAR: number | null
  paymentIntentId: string | null
  betId: string | null
  videoBlob: Blob | null
  declaredResult: 'hole_in_one' | 'miss' | null
  uploadStatus: UploadStatus
  uploadProgress: number // 0–100
}

interface BetContextType extends BetSession {
  selectCourse: (course: Course, hole: Hole) => void
  selectTier: (tier: BetTier) => void
  setPrizeZAR: (prize: number) => void
  confirmPayment: (intentId: string) => void
  setBetId: (id: string) => void
  setVideoBlob: (blob: Blob) => void
  declareResult: (result: 'hole_in_one' | 'miss') => void
  resetSession: () => void
  startBackgroundUpload: (blob: Blob, mimeType: string, betId: string, capture?: CaptureInput) => void
  /** Upload the current bet's footage again, with the recorder's report it was first sent with. */
  retryUpload: () => void
}

const defaultSession: BetSession = {
  selectedCourse: null,
  selectedHole: null,
  selectedTier: null,
  prizeZAR: null,
  paymentIntentId: null,
  betId: null,
  videoBlob: null,
  declaredResult: null,
  uploadStatus: 'idle',
  uploadProgress: 0,
}

const BetContext = createContext<BetContextType | null>(null)

export function BetProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<BetSession>(defaultSession)

  // The footage of the bet in hand, kept for retries; the slots the server
  // issued, reused once it stops issuing them (see upload-footage.ts); and
  // the bet whose upload is running, so a retry never doubles it.
  const footageRef = useRef<FootageJob | null>(null)
  const slotsRef = useRef(new Map<string, string>())
  const inFlightRef = useRef<string | null>(null)

  function selectCourse(course: Course, hole: Hole) {
    setSession(s => ({ ...s, selectedCourse: course, selectedHole: hole }))
  }
  // A new tier clears any golf day prize; the golf day screen sets its own after.
  function selectTier(tier: BetTier) {
    setSession(s => ({ ...s, selectedTier: tier, prizeZAR: null }))
  }
  function setPrizeZAR(prize: number) {
    setSession(s => ({ ...s, prizeZAR: prize }))
  }
  function confirmPayment(intentId: string) {
    setSession(s => ({ ...s, paymentIntentId: intentId }))
  }
  function setBetId(id: string) {
    setSession(s => ({ ...s, betId: id }))
  }
  function setVideoBlob(blob: Blob) {
    setSession(s => ({ ...s, videoBlob: blob }))
  }
  function declareResult(result: 'hole_in_one' | 'miss') {
    setSession(s => ({ ...s, declaredResult: result }))
  }
  function resetSession() {
    footageRef.current = null
    setSession(defaultSession)
  }

  // Status belongs to the footage in hand. An upload still running after
  // Play again must not mark the next bet's footage as saved.
  const forBet = useCallback((betId: string, patch: Partial<BetSession>) => {
    if (footageRef.current?.betId === betId) setSession(s => ({ ...s, ...patch }))
  }, [])

  const runUpload = useCallback((job: FootageJob) => {
    if (inFlightRef.current === job.betId) return
    inFlightRef.current = job.betId
    forBet(job.betId, { uploadStatus: 'uploading', uploadProgress: 0 })

    // Fire-and-forget — upload runs in the background
    uploadFootage(job, { fetch, put: xhrPut, slots: slotsRef.current }, pct => forBet(job.betId, { uploadProgress: pct }))
      .then(() => forBet(job.betId, { uploadStatus: 'done', uploadProgress: 100 }))
      .catch(err => {
        console.error('[upload] Background upload failed:', err)
        forBet(job.betId, { uploadStatus: 'error' })
      })
      .finally(() => {
        if (inFlightRef.current === job.betId) inFlightRef.current = null
      })
  }, [forBet])

  function startBackgroundUpload(blob: Blob, mimeType: string, betId: string, capture?: CaptureInput) {
    footageRef.current = { betId, blob, mimeType, capture }
    runUpload(footageRef.current)
  }

  const retryUpload = useCallback(() => {
    if (footageRef.current) runUpload(footageRef.current)
  }, [runUpload])

  // A phone locked or switched away mid-upload, or a dead spot on the
  // course, fails the upload. Try again when the app is back in front or
  // the signal returns, as long as the footage is still in memory.
  const uploadFailed = session.uploadStatus === 'error'
  useEffect(() => {
    if (!uploadFailed) return
    const retry = () => { if (document.visibilityState === 'visible') retryUpload() }
    document.addEventListener('visibilitychange', retry)
    window.addEventListener('online', retry)
    return () => {
      document.removeEventListener('visibilitychange', retry)
      window.removeEventListener('online', retry)
    }
  }, [uploadFailed, retryUpload])

  return (
    <BetContext.Provider
      value={{
        ...session,
        selectCourse,
        selectTier,
        setPrizeZAR,
        confirmPayment,
        setBetId,
        setVideoBlob,
        declareResult,
        resetSession,
        startBackgroundUpload,
        retryUpload,
      }}
    >
      {children}
    </BetContext.Provider>
  )
}

export function useBet() {
  const ctx = useContext(BetContext)
  if (!ctx) throw new Error('useBet must be used within BetProvider')
  return ctx
}
