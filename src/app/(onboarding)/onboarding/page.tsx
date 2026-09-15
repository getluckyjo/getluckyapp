'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Video, ShieldCheck, Star } from 'lucide-react'
import PhoneFrame from '@/components/layout/PhoneFrame'
import StepBar from '@/components/layout/StepBar'
import { GolfBallIcon } from '@/components/icons'
import { useAuth } from '@/context/AuthContext'

/* ── Slide data ── */
const slides = [
  {
    icon: 'ball' as const,
    bg: '/marketing/courses/st-francis-links.jpg',
    position: '50% 70%',
    title: 'Your hole\u2011in\u2011one\ncould pay R1M.',
    text: 'Pick any par 3 at 100+ South African courses. Stake from R50 to R1 000. Land the shot, win up to R1 million.',
    cta: 'Next',
  },
  {
    icon: 'video' as const,
    bg: '/marketing/courses/metropolitan.jpg',
    position: '50% 60%',
    title: 'Film it.\nSwing it.\nWin it.',
    text: 'Choose your course, pick your stake, and hit record before you swing. Three taps and you\'re playing for the big prize.',
    cta: 'Next',
  },
  {
    icon: 'shield' as const,
    bg: '/marketing/courses/zimbali.jpg',
    position: '62% 100%',
    title: 'Every prize\nfully insured.',
    text: 'Prizes underwritten by Indwe Risk Services (FSP 3425). Payments secured by PayFast. Your win is guaranteed.',
    cta: 'Next',
  },
  {
    icon: 'star' as const,
    bg: '/marketing/courses/paarl.jpg',
    position: '50% 65%',
    title: 'Join the\nGet Lucky Club.',
    text: 'Status, member-only perks and insured prizes from R149/month. Optional, and you can join any time from your account.',
    cta: 'Get started',
  },
]

function SlideIcon({ type }: { type: (typeof slides)[number]['icon'] }) {
  if (type === 'ball') return <GolfBallIcon size={34} />
  if (type === 'video') return <Video size={30} strokeWidth={2.2} />
  if (type === 'shield') return <ShieldCheck size={32} strokeWidth={2.2} />
  return <Star size={30} strokeWidth={2.2} />
}

/* ── Swipe hook ── */
function useSwipe(onLeft: () => void, onRight: () => void) {
  const startX = useRef(0)
  const startY = useRef(0)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
  }, [])

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX.current
      const dy = e.changedTouches[0].clientY - startY.current
      // Only trigger if horizontal swipe is dominant and > 50px
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) onLeft()
        else onRight()
      }
    },
    [onLeft, onRight],
  )

  return { onTouchStart, onTouchEnd }
}

/**
 * How it works — four beats on full-bleed course photos in the V2 system:
 * a four-segment step bar and Skip up top, a lime icon disc, the display
 * headline, one line of copy, and NEXT. Swipe or tap the dots to move.
 * Reached from the splash before sign-in and from the menu afterwards, so
 * the last button lands wherever makes sense for who's looking.
 */
export default function OnboardingPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [current, setCurrent] = useState(0)
  const [slideDir, setSlideDir] = useState<'left' | 'right'>('left')

  function finish() {
    try { localStorage.setItem('onboarding_seen', 'true') } catch { /* private mode */ }
    router.push(user ? '/home' : '/auth')
  }

  function goTo(i: number) {
    setSlideDir(i > current ? 'left' : 'right')
    setCurrent(i)
  }

  function goNext() {
    if (current < slides.length - 1) goTo(current + 1)
    else finish()
  }

  function goPrev() {
    if (current > 0) goTo(current - 1)
  }

  const swipe = useSwipe(goNext, goPrev)
  const slide = slides[current]
  const isLast = current === slides.length - 1

  return (
    <PhoneFrame statusTheme="light">
      <div className="v2-screen v2-screen--photo ob-screen" {...swipe}>
        <Image
          key={slide.bg}
          src={slide.bg}
          alt=""
          fill
          priority
          sizes="480px"
          className="v2-photo ob-photo"
          style={{ objectPosition: slide.position }}
        />
        <div
          className="v2-photo-scrim"
          aria-hidden
          style={{ background: 'linear-gradient(180deg, rgba(20,38,25,0.55) 0%, rgba(20,38,25,0.3) 40%, rgba(20,38,25,0.78) 100%)' }}
        />

        <div className="ob-top">
          <StepBar step={current + 1} total={slides.length} tone="dark" />
          <button type="button" className="ob-skip" onClick={finish}>
            {isLast ? 'Close' : 'Skip'}
          </button>
        </div>

        <div className="v2-body ob-body">
          <div className="v2-hero ob-slide" key={current} data-dir={slideDir}>
            <span className="ob-icon" aria-hidden><SlideIcon type={slide.icon} /></span>
            <span className="ob-step">How it works · {current + 1} of {slides.length}</span>
            <h1 className="v2-title">{slide.title}</h1>
            <p className="v2-sub ob-text">{slide.text}</p>
            <button type="button" className="btn-lime" onClick={goNext}>
              {slide.cta}
            </button>
          </div>

          <div className="ob-foot">
            <div className="ob-dots" role="tablist" aria-label="Slides">
              {slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === current}
                  aria-label={`Slide ${i + 1}`}
                  className={i === current ? 'active' : undefined}
                  onClick={() => goTo(i)}
                />
              ))}
            </div>
            {current > 0 && (
              <button type="button" className="ob-back" onClick={goPrev}>Back</button>
            )}
          </div>
        </div>
      </div>
    </PhoneFrame>
  )
}
