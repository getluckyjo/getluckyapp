'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import StepBar from '@/components/layout/StepBar'

/**
 * The page a magic link opens. One tap confirms — the actual verification is
 * a POST to /auth/confirm/verify so that link scanners, which only GET, can
 * never consume the token on the golfer's behalf.
 */
function ConfirmForm() {
  const params = useSearchParams()
  const tokenHash = params.get('token_hash') ?? ''
  const type = params.get('type') ?? 'magiclink'
  const next = params.get('next') ?? '/welcome'

  const copy = {
    recovery:     { title: 'Reset your\npassword', cta: 'Continue' },
    invite:       { title: 'Accept your\ninvite', cta: 'Accept' },
    email_change: { title: 'Confirm your\nnew email', cta: 'Confirm' },
  }[type] ?? { title: 'One tap\nand you’re in.', cta: 'Sign in' }

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />
        <div className="v2-body" style={{ paddingBottom: 'var(--space-2xl)' }}>
          <div className="v2-hero">
            <h1 className="v2-title">{copy.title}</h1>
            {tokenHash ? (
              <>
                <p className="v2-sub">Tap below to finish signing in to Get Lucky on this device.</p>
                <form method="post" action="/auth/confirm/verify">
                  <input type="hidden" name="token_hash" value={tokenHash} />
                  <input type="hidden" name="type" value={type} />
                  <input type="hidden" name="next" value={next} />
                  <button type="submit" className="btn-lime">{copy.cta}</button>
                </form>
              </>
            ) : (
              <>
                <p className="v2-sub">This link is missing its sign-in token. Ask for a fresh one and try again.</p>
                <a href="/auth" className="btn-lime">Back to sign in</a>
              </>
            )}
            <StepBar step={1} tone="light" className="v2-step" />
          </div>
        </div>
      </div>
    </PhoneFrame>
  )
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<PhoneFrame statusTheme="dark"><div className="v2-screen" /></PhoneFrame>}>
      <ConfirmForm />
    </Suspense>
  )
}
