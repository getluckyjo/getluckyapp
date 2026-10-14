'use client'

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import type { CaptureInput } from '@/lib/claims/capture'
import { deleteFootage, deleteFootageIfSealed, loadFootage, pickRecovery, saveFootage } from '@/lib/footage-store'
import { getUploadManager } from '@/lib/upload'

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

interface BetSession {
  selectedCourse: Course | null
  selectedHole: Hole | null
  selectedTier: BetTier | null
  /** The prize when it is not the tier's: a golf day swing's, set per golf day, in whole units of prizeCurrency. */
  prize: number | null
  /** A golf trip's prize can be in dollars (migration 033); every other prize is rand. */
  prizeCurrency: 'ZAR' | 'USD'
  paymentIntentId: string | null
  betId: string | null
  videoBlob: Blob | null
  /** The recorder's report for the footage in hand, so a retry carries it too. */
  capture: CaptureInput | null
  declaredResult: 'hole_in_one' | 'miss' | null
}

interface BetContextType extends BetSession {
  selectCourse: (course: Course, hole: Hole) => void
  selectTier: (tier: BetTier) => void
  setPrize: (prize: number, currency?: 'ZAR' | 'USD') => void
  confirmPayment: (intentId: string) => void
  setBetId: (id: string) => void
  setVideoBlob: (blob: Blob) => void
  declareResult: (result: 'hole_in_one' | 'miss') => void
  resetSession: () => void
  /**
   * Keeps the footage on the phone, then hands it to the upload manager
   * (src/lib/upload), which gets it to the server however long the signal
   * takes. Resolves once the local copy is written (or found unwritable),
   * before the upload: the caller can leave the recorder knowing the shot
   * is safe. Progress is read with useUpload(betId).
   */
  startBackgroundUpload: (blob: Blob, mimeType: string, betId: string, capture?: CaptureInput) => Promise<void>
  /** False until the phone's stored footage has been checked; the guards on confirm and result wait for it. */
  hydrated: boolean
}

const defaultSession: BetSession = {
  selectedCourse: null,
  selectedHole: null,
  selectedTier: null,
  prize: null,
  prizeCurrency: 'ZAR',
  paymentIntentId: null,
  betId: null,
  videoBlob: null,
  capture: null,
  declaredResult: null,
}

const BetContext = createContext<BetContextType | null>(null)

export function BetProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<BetSession>(defaultSession)
  const [hydrated, setHydrated] = useState(false)
  // The session as of the last render, for the upload's local save.
  const sessionRef = useRef(session)
  useEffect(() => { sessionRef.current = session })

  function selectCourse(course: Course, hole: Hole) {
    setSession(s => ({ ...s, selectedCourse: course, selectedHole: hole }))
  }
  // A new tier clears any golf day prize; the golf day screen sets its own after.
  function selectTier(tier: BetTier) {
    setSession(s => ({ ...s, selectedTier: tier, prize: null, prizeCurrency: 'ZAR' }))
  }
  function setPrize(prize: number, currency: 'ZAR' | 'USD' = 'ZAR') {
    setSession(s => ({ ...s, prize, prizeCurrency: currency }))
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
    // The local copy goes only once the server has the hash. An unsealed
    // shot stays for the upload manager, whatever screen the golfer is on.
    const betId = sessionRef.current.betId
    if (betId) void deleteFootageIfSealed(betId)
    setSession(defaultSession)
  }

  async function startBackgroundUpload(blob: Blob, mimeType: string, betId: string, capture?: CaptureInput) {
    setSession(s => ({ ...s, capture: capture ?? s.capture }))
    // The phone's copy first: from here a reload or a killed tab loses
    // nothing, and the next start resumes the upload.
    const { selectedCourse, selectedHole, selectedTier, prize, prizeCurrency } = sessionRef.current
    await saveFootage({ betId, blob, mimeType, capture: capture ?? null, session: { selectedCourse, selectedHole, selectedTier, prize, prizeCurrency }, savedAt: Date.now(), sealed: false })
    void getUploadManager().enqueue({ betId, blob, mimeType, capture: capture ?? null, alreadyStored: true })
  }

  // After a restart: put back the newest shot the phone still holds. The
  // upload manager (booted at the root) finishes every unsealed one; only
  // shots past their time are deleted here.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { restore, stale } = pickRecovery(await loadFootage(), Date.now())
        for (const id of stale) void deleteFootage(id)
        if (cancelled || !restore) return
        const { session: saved } = restore
        setSession(s => ({
          ...s,
          selectedCourse: (saved.selectedCourse as Course | null) ?? s.selectedCourse,
          selectedHole: (saved.selectedHole as Hole | null) ?? s.selectedHole,
          selectedTier: (saved.selectedTier as BetTier | null) ?? s.selectedTier,
          prize: saved.prize ?? s.prize,
          prizeCurrency: saved.prizeCurrency ?? s.prizeCurrency,
          betId: restore.betId,
          videoBlob: restore.blob,
          capture: restore.capture,
        }))
      } catch {
        /* no stored footage, or no storage: the flow starts fresh */
      } finally {
        if (!cancelled) setHydrated(true)
      }
    })()
    return () => { cancelled = true }
    // Once, on mount: the stored footage does not change underneath us.
  }, [])

  return (
    <BetContext.Provider
      value={{
        ...session,
        hydrated,
        selectCourse,
        selectTier,
        setPrize,
        confirmPayment,
        setBetId,
        setVideoBlob,
        declareResult,
        resetSession,
        startBackgroundUpload,
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
