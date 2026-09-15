'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import PhoneFrame from '@/components/layout/PhoneFrame'
import { GolfBallIcon } from '@/components/icons'
import { useBet } from '@/context/BetContext'
import type { CaptureInput } from '@/lib/claims/capture'

const MAX_SECONDS = 120 // 2 minutes max

export default function RecordPage() {
  const router = useRouter()
  const { selectedCourse, selectedHole, betId, setVideoBlob, startBackgroundUpload } = useBet()
  const [isRecording, setIsRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [permissionState, setPermissionState] = useState<'checking' | 'prompt' | 'granted' | 'denied' | 'unsupported'>('checking')

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const mimeTypeRef = useRef<string>('video/webm')
  // What the recorder can attest about this capture: when it started and
  // stopped, and where the phone was. Stored on the bet for the reviewer.
  // Location is asked for once, when recording starts; "don't allow" is
  // fine and simply leaves it blank.
  const captureRef = useRef<{ startedAt: string; position?: { lat: number; lng: number; accuracyM: number } } | null>(null)

  // Guard: require course + hole selection (must come through choose-stake flow)
  useEffect(() => {
    if (!selectedCourse || !selectedHole) {
      router.replace('/select-course')
    }
  }, [selectedCourse, selectedHole, router])

  const holeLabel = selectedHole
    ? `Hole ${selectedHole.holeNumber} · Par ${selectedHole.par} · ${selectedHole.distanceMetres}m`
    : ''
  const courseName = selectedCourse?.name ?? ''

  function formatTime(s: number) {
    const m = Math.floor(s / 60).toString().padStart(2, '0')
    const sec = (s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  // Request camera access and attach stream
  const requestCamera = useCallback(async () => {
    setPermissionState('checking')
    setCameraError(false)

    // Check if getUserMedia is available at all
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState('unsupported')
      setCameraError(true)
      setCameraReady(true)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 854 }, height: { ideal: 480 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => {})
      }
      setPermissionState('granted')
      setCameraReady(true)
    } catch (err: unknown) {
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError') {
        // User denied or dismissed the prompt — check if permanently denied
        try {
          const status = await navigator.permissions.query({ name: 'camera' as PermissionName })
          setPermissionState(status.state === 'denied' ? 'denied' : 'prompt')
        } catch (err) {
          console.warn('[record] camera permission query failed:', err)
          // permissions.query not supported — assume prompt can be retried
          setPermissionState('denied')
        }
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setPermissionState('unsupported')
      } else {
        setPermissionState('denied')
      }
      setCameraError(true)
      setCameraReady(true)
    }
  }, [])

  // Start camera preview on mount
  useEffect(() => {
    let cancelled = false

    async function init() {
      // Pre-check permission state if API is available
      try {
        const status = await navigator.permissions.query({ name: 'camera' as PermissionName })
        if (cancelled) return
        if (status.state === 'denied') {
          setPermissionState('denied')
          setCameraError(true)
          setCameraReady(true)
          return
        }
        // 'granted' or 'prompt' — proceed to request
      } catch (err) {
        console.warn('[record] recorder setup failed:', err)
        // permissions API not supported — just request directly
      }

      if (!cancelled) requestCamera()
    }

    init()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [requestCamera])

  const handleRecordingComplete = useCallback((blob: Blob, mimeType: string) => {
    setVideoBlob(blob)
    const started = captureRef.current
    const endedAt = new Date().toISOString()
    const capture: CaptureInput | undefined = started
      ? {
          startedAt: started.startedAt,
          endedAt,
          durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(started.startedAt)),
          ...(started.position ? { lat: started.position.lat, lng: started.position.lng, accuracyM: started.position.accuracyM } : {}),
        }
      : undefined
    startBackgroundUpload(blob, mimeType, betId ?? 'pending', capture) // runs in background — doesn't block
    router.push('/confirm')
  }, [setVideoBlob, startBackgroundUpload, betId, router])

  function requestPosition() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (captureRef.current) {
          captureRef.current.position = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }
        }
      },
      () => { /* declined or unavailable: the reviewer sees no location */ },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  }

  function startRecording() {
    if (!streamRef.current) return // No camera — permission overlay handles this

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/mp4')
      ? 'video/mp4'
      : 'video/webm'

    mimeTypeRef.current = mimeType
    chunksRef.current = []
    captureRef.current = { startedAt: new Date().toISOString() }
    requestPosition()

    const mr = new MediaRecorder(streamRef.current, {
      mimeType,
      videoBitsPerSecond: 500_000, // 500 Kbps — ~7.5 MB for 2 min at 480p (mobile-friendly)
    })
    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current })
      streamRef.current?.getTracks().forEach(t => t.stop())
      handleRecordingComplete(blob, mimeTypeRef.current)
    }
    mr.start(1000) // 1s chunks — less overhead than 100ms
    mediaRecorderRef.current = mr
    setIsRecording(true)
    setSeconds(0)
    timerRef.current = setInterval(() => setSeconds(s => {
      if (s + 1 >= MAX_SECONDS) { stopRecordingRef.current() }
      return s + 1
    }), 1000)
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current)

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }

  // Stable ref to avoid stale closure in timer
  const stopRecordingRef = useRef(stopRecording)
  useEffect(() => { stopRecordingRef.current = stopRecording })

  function handleCancel() {
    if (timerRef.current) clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    router.push('/choose-stake')
  }

  const overlayCopy = {
    unsupported: {
      title: 'No camera\nfound',
      body: 'This device has no camera, or the browser can\u2019t reach it. Try the phone you play from.',
      cta: null,
    },
    denied: {
      title: 'Camera\nblocked',
      body: 'Allow camera access in your browser settings, then tap below to try again.',
      cta: 'Try again',
    },
    prompt: {
      title: 'Camera\naccess',
      body: 'We need the camera to film your shot. Tap below and allow access when asked.',
      cta: 'Enable camera',
    },
    checking: { title: 'One\nmoment', body: 'Asking for camera access\u2026', cta: null },
    granted:  { title: '', body: '', cta: null },
  }[permissionState]

  // Don't render until we know we have valid state. Sits after every hook so
  // the hook order is identical on every render.
  if (!selectedCourse || !selectedHole) return null

  return (
    <PhoneFrame statusTheme="light" showStatus={false}>
      <div className="rec">
        {/* Live camera feed */}
        {!cameraError ? (
          <video ref={videoRef} muted playsInline className="rec-video" />
        ) : (
          <div className="rec-fallback" />
        )}
        <div className="rec-scrim" aria-hidden />
        <div className="rec-grid" aria-hidden />

        {/* Top row: close, REC/READY + timer, brand sticker */}
        <div className="rec-top">
          <button type="button" className="rec-close" aria-label="Cancel and go back" onClick={handleCancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
          <div className={`rec-status${isRecording ? ' is-recording' : ''}`} aria-live="polite">
            <span className="rec-dot" aria-hidden />
            {isRecording ? 'Rec' : 'Ready'}
            <span className="rec-timer">{formatTime(seconds)}</span>
          </div>
          <Image src="/brand/logo-corner.svg" alt="Get Lucky" width={173} height={133} unoptimized className="rec-sticker" draggable={false} />
        </div>

        {/* Camera permission overlay */}
        {cameraError && (
          <div className="rec-overlay">
            <h2 className="v2-title rec-overlay-title">{overlayCopy.title}</h2>
            <p className="rec-overlay-body">{overlayCopy.body}</p>
            {overlayCopy.cta && (
              <button type="button" className="btn-lime" onClick={requestCamera}>{overlayCopy.cta}</button>
            )}
            <button type="button" className="rec-overlay-back" onClick={handleCancel}>Go back</button>
          </div>
        )}

        {/* Hole + course, then the record control */}
        <div className="rec-bottom">
          <div className="rec-hole">{holeLabel}</div>
          <div className="rec-course">{courseName}</div>

          {!isRecording && cameraReady && !cameraError && (
            <div className="rec-hint">Tap the ball to start recording</div>
          )}
          {isRecording && (
            <div className="rec-hint rec-hint--live">Recording · tap to stop when the ball lands · max 2:00</div>
          )}

          <button
            type="button"
            className={`rec-button${isRecording ? ' is-recording' : ''}`}
            style={{ '--rec-progress': `${(seconds / MAX_SECONDS) * 100}%` } as React.CSSProperties}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!cameraReady || cameraError}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
          >
            <span className="rec-ring" aria-hidden />
            <span className="rec-button-disc">
              {isRecording ? <span className="rec-button-stop" /> : <GolfBallIcon size={44} />}
            </span>
          </button>
        </div>
      </div>
    </PhoneFrame>
  )
}
