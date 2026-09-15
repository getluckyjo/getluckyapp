'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
import type { CaptureInput } from '@/lib/claims/capture'

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
  confirmPayment: (intentId: string) => void
  setBetId: (id: string) => void
  setVideoBlob: (blob: Blob) => void
  declareResult: (result: 'hole_in_one' | 'miss') => void
  resetSession: () => void
  startBackgroundUpload: (blob: Blob, mimeType: string, betId: string, capture?: CaptureInput) => void
}

const defaultSession: BetSession = {
  selectedCourse: null,
  selectedHole: null,
  selectedTier: null,
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

  function selectCourse(course: Course, hole: Hole) {
    setSession(s => ({ ...s, selectedCourse: course, selectedHole: hole }))
  }
  function selectTier(tier: BetTier) {
    setSession(s => ({ ...s, selectedTier: tier }))
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
    setSession(defaultSession)
  }

  function startBackgroundUpload(blob: Blob, mimeType: string, betId: string, capture?: CaptureInput) {
    setSession(s => ({ ...s, uploadStatus: 'uploading', uploadProgress: 0 }))

    // Fire-and-forget — upload runs in the background
    ;(async () => {
      try {
        const urlRes = await fetch('/api/videos/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ betId, mimeType, ...(capture ? { capture } : {}) }),
        })
        const { signedUrl } = await urlRes.json()

        if (signedUrl) {
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open('PUT', signedUrl)
            xhr.setRequestHeader('Content-Type', mimeType)
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100)
                setSession(s => ({ ...s, uploadProgress: pct }))
              }
            }
            xhr.onload = () =>
              xhr.status < 300 ? resolve() : reject(new Error(`Upload ${xhr.status}`))
            xhr.onerror = () => reject(new Error('Network error'))
            xhr.send(blob)
          })

          // The server reads the object back and records its hash, size and
          // its own timestamp on the bet. Without this the footage is
          // uploaded but not sealed, so treat a failure as an upload failure.
          const sealRes = await fetch('/api/videos/uploaded', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ betId }),
          })
          if (!sealRes.ok) throw new Error(`Seal ${sealRes.status}`)
        } else {
          throw new Error('No upload slot')
        }

        setSession(s => ({ ...s, uploadStatus: 'done', uploadProgress: 100 }))
      } catch (err) {
        console.error('[upload] Background upload failed:', err)
        setSession(s => ({ ...s, uploadStatus: 'error' }))
      }
    })()
  }

  return (
    <BetContext.Provider
      value={{
        ...session,
        selectCourse,
        selectTier,
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
