'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import AdminSidebar from '@/components/admin/AdminSidebar'
import AdminTopBar from '@/components/admin/AdminTopBar'
import { useAuth } from '@/context/AuthContext'
import { createClient } from '@/lib/supabase/client'
import './admin.css'

/**
 * The admin shell, and the gate in front of it.
 *
 * The server is the authority on who is an admin: every /api/admin/* handler
 * runs requireAdmin() against the session cookie and the service-role read of
 * profiles.is_admin. This gate asks it rather than trusting the browser's copy
 * of the profile, which arrives after the session.
 *
 * /api/admin/me is that question, and the sidebar's badge, in one light call
 * (asked again on every page change and on focus). Its two refusals mean
 * different things and are handled differently:
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
  const pathname = usePathname()
  const [access, setAccess] = useState<Access>('checking')
  const [pendingClaims, setPendingClaims] = useState(0)
  const [adminInfo, setAdminInfo] = useState({ name: '', email: '' })
  // The sidebar as a drawer on a phone or narrow window (admin.css hides it below 900 px).
  const [menuOpen, setMenuOpen] = useState(false)

  const check = useCallback(async (): Promise<Access> => {
    const ask = () => fetch('/api/admin/me', { credentials: 'same-origin', cache: 'no-store' })

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
    if (typeof data.claimsToReview === 'number') setPendingClaims(data.claimsToReview)
    if (data.name) setAdminInfo({ name: data.name, email: data.email || '' })
    return 'allowed'
  }, [])

  // The badge follows the queue: asked again on every page change and when the window comes back.
  useEffect(() => {
    if (access !== 'allowed') return
    let cancelled = false
    const refresh = () => {
      fetch('/api/admin/me', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (!cancelled && d && typeof d.claimsToReview === 'number') setPendingClaims(d.claimsToReview) })
        .catch(() => {})
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; window.removeEventListener('focus', refresh) }
  }, [access, pathname])

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
    // Back to the page they were on once signed in (safeNext allows /admin/…).
    if (access === 'signed-out') router.replace(`/auth?next=${encodeURIComponent(pathname || '/admin')}`)
  }, [access, router, pathname])

  if (loading || access === 'checking') return <Centred><Spinner /></Centred>

  // The redirect to sign-in is in progress; render nothing rather than a flash.
  if (access === 'signed-out') return null

  if (access === 'not-admin') {
    return (
      <Centred>
        <div className="adm-h2">This account cannot open the admin</div>
        <div className="adm-muted" style={{ fontSize: 14, maxWidth: 420 }}>
          {user?.email ? `Signed in as ${user.email}.` : 'Signed in.'} Ask for the admin flag on this account, or sign in with another.
        </div>
        <Button onClick={() => router.replace('/home')}>Back to the app</Button>
      </Centred>
    )
  }

  if (access === 'unavailable') {
    return (
      <Centred>
        <div className="adm-h2">The admin could not be reached</div>
        <div className="adm-muted" style={{ fontSize: 14 }}>Check your connection and try again.</div>
        <Button onClick={() => { setAccess('checking'); check().then(setAccess).catch(() => setAccess('unavailable')) }}>
          Try again
        </Button>
      </Centred>
    )
  }

  return (
    <div className="adm">
      <AdminSidebar pendingClaims={pendingClaims} open={menuOpen} onClose={() => setMenuOpen(false)} />
      {menuOpen && <div className="adm-scrim" onClick={() => setMenuOpen(false)} aria-hidden />}
      <div className="adm-body">
        <AdminTopBar adminName={adminInfo.name} adminEmail={adminInfo.email} onMenu={() => setMenuOpen(true)} />
        <main className="adm-main">
          {children}
        </main>
      </div>
    </div>
  )
}

function Centred({ children }: { children: React.ReactNode }) {
  return (
    <div className="adm-centred">
      {children}
    </div>
  )
}

function Spinner() {
  return <div className="adm-spinner" role="status" aria-label="Loading" />
}

function Button({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="adm-btn">
      {children}
    </button>
  )
}
