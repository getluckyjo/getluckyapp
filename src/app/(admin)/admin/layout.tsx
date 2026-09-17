'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/admin/AdminSidebar'
import AdminTopBar from '@/components/admin/AdminTopBar'
import { useAuth } from '@/context/AuthContext'
import { createClient } from '@/lib/supabase/client'

/**
 * The admin shell, and the gate in front of it.
 *
 * The server is the authority on who is an admin: every /api/admin/* handler
 * runs requireAdmin() against the session cookie and the service-role read of
 * profiles.is_admin. This gate asks it rather than trusting the browser's copy
 * of the profile, which arrives after the session.
 *
 * /api/admin/stats is that question and the sidebar's badge in one call. Its
 * two refusals mean different things and are handled differently:
 *
 *   401 — the server saw no session. That is a sign-in problem, not a
 *         permission one, and it happens on a cold load while the access token
 *         is still being refreshed. Refresh once, ask again, and only then send
 *         the person to sign in, carrying /admin so they come back here.
 *   403 — a real session that is not an admin. Say so on the screen. Bouncing
 *         silently to /home is what made this impossible to diagnose.
 *
 * Anything else (a 500, offline) leaves the person where they are with a
 * message, rather than throwing them out of a page they may well be allowed
 * to see.
 */
type Access = 'checking' | 'allowed' | 'signed-out' | 'not-admin' | 'unavailable'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [access, setAccess] = useState<Access>('checking')
  const [pendingClaims, setPendingClaims] = useState(0)
  const [adminInfo, setAdminInfo] = useState({ name: '', email: '' })

  const check = useCallback(async (): Promise<Access> => {
    const ask = () => fetch('/api/admin/stats', { credentials: 'same-origin', cache: 'no-store' })

    let res = await ask()

    // A cold load can reach the server before the refreshed access token has
    // been written back to the cookie. Give the client one chance to settle
    // the session, then ask again; a second 401 is a real one.
    if (res.status === 401) {
      try {
        const { data } = await createClient().auth.getSession()
        if (data.session) res = await ask()
      } catch {
        // Fall through to the answer we already have.
      }
    }

    if (res.status === 401) return 'signed-out'
    if (res.status === 403) return 'not-admin'
    if (!res.ok) return 'unavailable'

    const data = await res.json().catch(() => ({}))
    if (data.pendingClaims !== undefined) setPendingClaims(data.pendingClaims)
    if (data.adminName) setAdminInfo({ name: data.adminName, email: data.adminEmail || '' })
    return 'allowed'
  }, [])

  useEffect(() => {
    // Wait for the session to be attached before asking, so a cold load does
    // not ask as a stranger and get told no.
    if (loading) return
    let cancelled = false
    void (async () => {
      let next: Access
      try {
        next = await check()
      } catch {
        next = 'unavailable'
      }
      if (!cancelled) setAccess(next)
    })()
    return () => { cancelled = true }
  }, [loading, check])

  useEffect(() => {
    // Sign in, then come straight back here.
    if (access === 'signed-out') router.replace('/auth?next=/admin')
  }, [access, router])

  if (loading || access === 'checking') return <Centred><Spinner /></Centred>

  // The redirect to sign-in is in progress; render nothing rather than a flash.
  if (access === 'signed-out') return null

  if (access === 'not-admin') {
    return (
      <Centred>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>This account cannot open the admin</div>
        <div style={{ fontSize: 13, color: '#666' }}>
          {user?.email ? `Signed in as ${user.email}.` : 'Signed in.'} Ask for the admin flag on this account, or sign in with another.
        </div>
        <Button onClick={() => router.replace('/home')}>Back to the app</Button>
      </Centred>
    )
  }

  if (access === 'unavailable') {
    return (
      <Centred>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>The admin could not be reached</div>
        <div style={{ fontSize: 13, color: '#666' }}>Check your connection and try again.</div>
        <Button onClick={() => { setAccess('checking'); check().then(setAccess).catch(() => setAccess('unavailable')) }}>
          Try again
        </Button>
      </Centred>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: '#f7f7f8',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <AdminSidebar pendingClaims={pendingClaims} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <AdminTopBar adminName={adminInfo.name} adminEmail={adminInfo.email} />
        <main style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  )
}

function Centred({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: '#f7f7f8', fontFamily: "'Inter', system-ui, sans-serif",
      padding: 24, textAlign: 'center',
    }}>
      {children}
    </div>
  )
}

function Spinner() {
  return (
    <>
      <div style={{
        width: 40, height: 40, border: '3px solid #e5e7eb',
        borderTopColor: '#335231', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  )
}

function Button({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#335231', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
    >
      {children}
    </button>
  )
}
