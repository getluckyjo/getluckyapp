'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import PhoneFrame from '@/components/layout/PhoneFrame'
import SponsorBanner from '@/components/layout/SponsorBanner'
import { useAuth } from '@/context/AuthContext'

/**
 * Landing — "Landing Page.png".
 * Course photo hazed to white at the top, WELCOME TO, the Hole-in-1 Challenge
 * lockup, GET STARTED, and the Indwe sponsor band along the bottom.
 */
export default function LandingPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  // Someone who is already signed in has no business on the welcome mat.
  useEffect(() => {
    if (!loading && user) router.replace('/home')
  }, [user, loading, router])

  return (
    <PhoneFrame statusTheme="dark">
      <div className="landing">
        <Image
          src="/marketing/courses/st-francis-links.jpg"
          alt=""
          fill
          priority
          sizes="480px"
          className="landing-photo"
        />
        <div className="landing-haze" aria-hidden />

        <div className="landing-body">
          <h1 className="landing-welcome">Welcome to</h1>
          <Image
            src="/brand/logo-lockup.svg"
            alt="Get Lucky Hole-in-1 Challenge"
            width={552}
            height={588}
            unoptimized
            priority
            className="landing-lockup"
            draggable={false}
          />
          <button
            type="button"
            className="btn-lime landing-cta"
            onClick={() => router.push('/auth')}
          >
            Get started
          </button>
          <button type="button" className="landing-link" onClick={() => router.push('/onboarding')}>
            New here? See how it works
          </button>
        </div>

        <SponsorBanner />
      </div>
    </PhoneFrame>
  )
}
