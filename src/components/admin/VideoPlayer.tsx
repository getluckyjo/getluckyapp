'use client'

import { ChevronLeft, ChevronRight, Pause, Play, RotateCw, VideoOff } from 'lucide-react'
import { useRef, useState } from 'react'

interface VideoPlayerProps {
  src: string | null
  poster?: string
  /** Shown in place of the player when there is no src: why there is no footage. */
  emptyText?: string
  /** The video failed to load. Signed links last an hour, so the owner may fetch new ones. */
  onLinkError?: () => void
  /** Fetch new links now. Without it, a failure has no reload button. */
  onReload?: () => void
}

/** One frame of phone footage at 30 fps: the step for the frame buttons and the arrow keys. */
const FRAME_SECONDS = 1 / 30
const SPEEDS = [0.25, 0.5, 1] as const

/**
 * The shot footage, for a reviewer who must confirm they saw the ball go in:
 * the browser's own controls to scrub, slow motion, and frame-by-frame steps
 * (the buttons, or ← and → while the video has focus).
 */
export default function VideoPlayer({ src, poster, emptyText = 'No video available', onLinkError, onReload }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  // The src that failed: a new link (a new src) clears the error by itself.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [failures, setFailures] = useState(0)
  // Where the reviewer was, so new links carry on from the same frame.
  const resumeAt = useRef(0)

  if (!src) {
    return (
      <div className="adm-muted" style={{ ...BOX, background: 'var(--surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20, textAlign: 'center', fontSize: 14 }}>
        <VideoOff size={28} aria-hidden />
        <span>{emptyText}</span>
        {onReload && (
          <button type="button" onClick={onReload} className="adm-btn adm-btn--quiet"><RotateCw size={14} aria-hidden /> Reload the claim</button>
        )}
      </div>
    )
  }

  const failed = failedSrc === src

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      // play() rejects when the browser blocks it or the source fails; the error event covers the latter.
      v.play().catch(() => setPlaying(false))
    } else {
      v.pause()
    }
  }

  const step = (frames: number) => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    const end = Number.isFinite(v.duration) ? v.duration : Infinity
    v.currentTime = Math.min(Math.max(0, v.currentTime + frames * FRAME_SECONDS), end)
  }

  const changeSpeed = (s: number) => {
    setSpeed(s)
    if (videoRef.current) videoRef.current.playbackRate = s
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLVideoElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    // In place of the browser's own 5-second jump.
    e.preventDefault()
    step(e.key === 'ArrowLeft' ? -1 : 1)
  }

  return (
    <div>
      <div style={{ ...BOX, position: 'relative', background: '#000' }}>
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          controls
          playsInline
          preload="metadata"
          aria-label="Shot footage. Left and right arrow keys step one frame."
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={e => {
            const v = e.currentTarget
            v.playbackRate = speed
            if (resumeAt.current > 0 && resumeAt.current < v.duration) v.currentTime = resumeAt.current
          }}
          onTimeUpdate={e => {
            // A new src resets the time to 0 before it has loaded; that is not where the reviewer was.
            if (e.currentTarget.readyState > 0) resumeAt.current = e.currentTarget.currentTime
          }}
          onError={() => {
            setFailedSrc(src)
            setFailures(n => n + 1)
            setPlaying(false)
            onLinkError?.()
          }}
          onKeyDown={onKeyDown}
        />
        {failed && (
          <div role="alert" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20, textAlign: 'center', background: 'rgba(13, 22, 15, 0.86)', color: 'var(--white)' }}>
            <VideoOff size={28} aria-hidden />
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14, maxWidth: 300 }}>
              {failures > 1
                ? 'The video still will not play here. It may be in a format this browser cannot play.'
                : 'The video link has expired. Reload the claim.'}
            </p>
            {onReload && (
              <button type="button" onClick={onReload} className="adm-btn adm-btn--quiet"><RotateCw size={14} aria-hidden /> Reload the claim</button>
            )}
            {failures > 1 && (
              <a href={src} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--lime)', fontWeight: 700 }}>Open the file in a new tab</a>
            )}
          </div>
        )}
      </div>

      <div className="adm-row" style={{ marginTop: 10, alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={toggle} disabled={failed} className="adm-btn adm-btn--quiet" style={{ minWidth: 92 }}>
          {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <div role="group" aria-label="Playback speed" style={{ display: 'flex', gap: 4 }}>
          {SPEEDS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => changeSpeed(s)}
              aria-pressed={speed === s}
              className={`adm-btn ${speed === s ? 'adm-btn--green' : 'adm-btn--quiet'}`}
              style={{ padding: '0 12px' }}
            >
              {s}×
            </button>
          ))}
        </div>
        <div role="group" aria-label="Step one frame" style={{ display: 'flex', gap: 4 }}>
          <button type="button" onClick={() => step(-1)} disabled={failed} className="adm-icon-btn" aria-label="Back one frame" title="Back one frame (←)"><ChevronLeft size={17} /></button>
          <button type="button" onClick={() => step(1)} disabled={failed} className="adm-icon-btn" aria-label="Forward one frame" title="Forward one frame (→)"><ChevronRight size={17} /></button>
        </div>
      </div>
      <p className="adm-small" style={{ margin: '6px 0 0' }}>Click the video, then ← and → step one frame (1/30 s).</p>
    </div>
  )
}

/** Phone footage is portrait; the box stays a sensible height on a wide screen. */
const BOX: React.CSSProperties = { width: '100%', aspectRatio: '9 / 16', maxHeight: 480, borderRadius: 12, overflow: 'hidden' }
