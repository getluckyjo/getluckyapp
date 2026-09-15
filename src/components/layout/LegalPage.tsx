'use client'

import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'

/**
 * Shell for the legal pages (terms, privacy, responsible play) in the V2
 * system: header, display title, an "effective" line, and the copy set in
 * a readable measure. Children are plain <h2> / <p> / <ul>; `.legal` styles
 * them. The tab bar stays so a golfer who arrived from the menu can carry on.
 */
export default function LegalPage({
  title,
  effective,
  children,
}: {
  title: string
  effective?: string
  children: React.ReactNode
}) {
  const router = useRouter()

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />
        <div className="vf-scroll legal">
          <button type="button" className="legal-back" onClick={() => router.back()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
            Back
          </button>
          <h1 className="v2-title" style={{ marginBottom: 6 }}>{title}</h1>
          {effective && <p className="legal-effective">Effective {effective}</p>}
          <div className="legal-body">{children}</div>
          <p className="legal-contact">
            Questions? <a href="mailto:support@getluckygolf.co.za">support@getluckygolf.co.za</a>
          </p>
        </div>
        <BottomTabBar />
      </div>
    </PhoneFrame>
  )
}
