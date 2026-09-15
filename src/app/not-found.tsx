'use client'

import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'
import { GolfBallIcon } from '@/components/icons'

export default function NotFound() {
  const router = useRouter()

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />
        <div className="v2-body">
          <div className="v2-hero">
            <span className="nf-ball" aria-hidden>
              <GolfBallIcon size={44} />
            </span>
            <h1 className="v2-title">{'Out of\nbounds'}</h1>
            <p className="v2-sub">That page doesn&apos;t exist.{'\n'}Let&apos;s get you back on the fairway.</p>
            <button type="button" className="btn-lime" onClick={() => router.push('/home')}>
              Back to home
            </button>
          </div>
        </div>
        <BottomTabBar />
      </div>
    </PhoneFrame>
  )
}
