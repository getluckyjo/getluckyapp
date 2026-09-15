'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'
import StepBar from '@/components/layout/StepBar'
import { useAuth } from '@/context/AuthContext'

/**
 * All set — "Sign-In Completed.png".
 * The beat straight after sign-in: dark turf photo, ALL SET! SWING YOUR SHOT.,
 * SELECT A COURSE, step 2 of 3, tab bar.
 */
export default function WelcomePage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  // Reached by redirect from the auth callback. If the session never landed,
  // send them back to sign in rather than showing a congratulation to nobody.
  useEffect(() => {
    if (!loading && !user) router.replace('/auth')
  }, [user, loading, router])

  return (
    <PhoneFrame statusTheme="light">
      <div className="v2-screen v2-screen--photo">
        <Image
          src="/marketing/courses/zimbali.jpg"
          alt=""
          fill
          priority
          sizes="480px"
          className="v2-photo"
          style={{ objectPosition: '62% 100%' }}
        />
        <div
          className="v2-photo-scrim"
          aria-hidden
          style={{ background: 'linear-gradient(180deg, rgba(20,38,25,0.55) 0%, rgba(20,38,25,0.35) 45%, rgba(20,38,25,0.6) 100%)' }}
        />

        <AppHeader tone="dark" />

        <div className="v2-body">
          <div className="v2-hero">
            <h1 className="v2-title">{'All set!\nSwing\nyour shot.'}</h1>
            <button
              type="button"
              className="btn-lime"
              onClick={() => router.push('/select-course')}
            >
              Select a course
            </button>
          </div>
          <StepBar step={2} tone="dark" className="v2-step" />
        </div>

        <BottomTabBar active="play" />
      </div>
    </PhoneFrame>
  )
}
