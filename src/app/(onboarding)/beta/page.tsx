'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import PhoneFrame from '@/components/layout/PhoneFrame'
import { useAuth } from '@/context/AuthContext'
import { haptics } from '@/lib/haptics'

const SAFE_NEXT = /^\/[a-z0-9\-/]*$/i

/**
 * The closed-beta gate. A tester lands here when BETA_GATE is on and neither
 * their email nor a redeemed code is on the list. Two ways in: type the
 * invite code, or sign in with the email that was invited.
 */
function BetaGate() {
  const router = useRouter()
  const params = useSearchParams()
  const { user } = useAuth()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nextParam = params.get('next') ?? '/home'
  const next = SAFE_NEXT.test(nextParam) && !nextParam.startsWith('//') ? nextParam : '/home'

  async function redeem(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/beta/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        haptics.warn()
        setError(body.error ?? 'That code did not work. Check it and try again.')
        setBusy(false)
        return
      }
      haptics.success()
      router.replace(next)
    } catch {
      setError('Could not reach Get Lucky. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen beta-screen">
        <div className="v2-body beta-body">
          <Image src="/brand/logo-lockup.svg" alt="Get Lucky Hole-in-1 Challenge" width={552} height={588} unoptimized priority className="beta-lockup" draggable={false} />
          <h1 className="beta-title">Closed beta</h1>
          <p className="beta-copy">
            Get Lucky is being tested with a small group of golfers before launch.
            Enter the invite code you were sent, or sign in with the email address that was invited.
          </p>

          <form className="beta-form" onSubmit={redeem}>
            <label className="sr-only" htmlFor="beta-code">Invite code</label>
            <input
              id="beta-code"
              className="beta-input"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="GL-XXXXXXXX"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              maxLength={40}
            />
            {error && <p className="beta-error" role="alert">{error}</p>}
            <button type="submit" className="btn-lime beta-submit" disabled={busy || !code.trim()}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>

          <div className="beta-alt">
            {user ? (
              <p>Signed in as <strong>{user.email}</strong>. That address is not on the list yet; ask for it to be added, or use a code.</p>
            ) : (
              <button type="button" className="beta-link" onClick={() => router.push(`/auth?next=${encodeURIComponent(next)}`)}>
                Sign in with an invited email
              </button>
            )}
          </div>
        </div>
      </div>
    </PhoneFrame>
  )
}

export default function BetaPage() {
  return (
    <Suspense fallback={null}>
      <BetaGate />
    </Suspense>
  )
}
