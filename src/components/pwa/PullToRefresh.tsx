'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GolfBallIcon } from '@/components/icons'
import { haptics } from '@/lib/haptics'
import { requestRefresh } from '@/hooks/useRefreshSignal'

const THRESHOLD = 72
const MAX_PULL = 110
const SETTLE_MS = 900

/**
 * Branded pull-to-refresh for the main scrollable views. Mount it once
 * inside the screen; it listens to touch events on the screen container
 * and only engages when nothing between the finger and the screen is
 * scrolled away from the top, so a list mid-scroll never triggers it.
 *
 * On release past the threshold it asks every listening screen to refetch
 * (useRefreshSignal) and refreshes the router in case the server has new
 * data. The indicator is the lime Play disc with the golf ball, which drops
 * in, spins while working, and settles back.
 */
export default function PullToRefresh() {
  const router = useRouter()
  const hostRef = useRef<HTMLDivElement>(null)
  const startY = useRef<number | null>(null)
  const armed = useRef(false)
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const host = hostRef.current?.parentElement
    if (!host) return

    const scrolledAway = (el: Element | null): boolean => {
      for (let node = el; node && node !== host.parentElement; node = node.parentElement) {
        if (node instanceof HTMLElement && node.scrollTop > 0) return true
      }
      return host.scrollTop > 0
    }

    const onStart = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1) return
      if (scrolledAway(e.target as Element)) { startY.current = null; return }
      startY.current = e.touches[0].clientY
      armed.current = false
    }
    const onMove = (e: TouchEvent) => {
      if (startY.current === null || busy) return
      const dy = e.touches[0].clientY - startY.current
      if (dy <= 0) { setPull(0); return }
      if (scrolledAway(e.target as Element)) { startY.current = null; setPull(0); return }
      // Rubber-band: the disc moves slower than the finger.
      const eased = Math.min(MAX_PULL, dy * 0.55)
      setPull(eased)
      if (eased >= THRESHOLD && !armed.current) { armed.current = true; haptics.tap() }
      if (eased < THRESHOLD) armed.current = false
    }
    const onEnd = () => {
      if (startY.current === null) return
      startY.current = null
      if (armed.current) {
        armed.current = false
        setBusy(true)
        setPull(THRESHOLD)
        requestRefresh()
        router.refresh()
        window.setTimeout(() => { setBusy(false); setPull(0) }, SETTLE_MS)
      } else {
        setPull(0)
      }
    }

    host.addEventListener('touchstart', onStart, { passive: true })
    host.addEventListener('touchmove', onMove, { passive: true })
    host.addEventListener('touchend', onEnd)
    host.addEventListener('touchcancel', onEnd)
    return () => {
      host.removeEventListener('touchstart', onStart)
      host.removeEventListener('touchmove', onMove)
      host.removeEventListener('touchend', onEnd)
      host.removeEventListener('touchcancel', onEnd)
    }
  }, [busy, router])

  const progress = Math.min(1, pull / THRESHOLD)

  return (
    <div ref={hostRef} className="ptr" aria-hidden={pull === 0} style={{ '--ptr-pull': `${pull}px`, '--ptr-progress': progress } as React.CSSProperties}>
      <div className={`ptr-disc${busy ? ' is-busy' : ''}${progress >= 1 ? ' is-armed' : ''}`}>
        <GolfBallIcon size={26} />
      </div>
      {busy && <span className="sr-only" role="status">Refreshing</span>}
    </div>
  )
}
