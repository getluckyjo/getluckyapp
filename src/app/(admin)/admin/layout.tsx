'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/admin/AdminSidebar'
import AdminTopBar from '@/components/admin/AdminTopBar'
import { useAuth } from '@/context/AuthContext'

/**
 * The admin shell, and the gate in front of it.
 *
 * The server is the authority on who is an admin: every /api/admin/* handler
 * runs requireAdmin() against the session cookie and the service-role read of
 * profiles.is_admin. This gate therefore asks the server rather than trusting
 * the browser's copy of the profile, which arrives after the session and made
 * the screen bounce a real admin to /home while it was still loading.
 *
 * /api/admin/stats is that question and the sidebar's badge in one call:
 * 200 means admin, 401 or 403 means not, and anything else (offline, a 500)
 * leaves the person where they are with a message instead of throwing them
 * out of a page they are allowed to see.
 */
type Access = 'checking' | 'allowed' | 'denied' | 'unavailable'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth()
  const router = useRouter()
  const [access, setAccess] = useState<Access>('checking')
  const [pendingClaims, setPendingClaims] = useState(0)
  const [adminInfo, setAdminInfo] = useState({ name: '', email: '' })

  useEffect(() => {
    // Wait for the session to be attached before asking, so a cold load does
    // not ask as a stranger and get told no.
    if (loading) return
    let cancelled = false

    fetch('/api/admin/stats')
      .then(async res => {
        if (cancelled) return
        if (res.status === 401 || res.status === 403) {
          setAccess('denied')
          return
        }
        if (!res.ok) {
          setAccess('unavailable')
          return
        }
        const data = await res.json().catch(() => ({}))
        setAccess('allowed')
        if (data.pendingClaims !== undefined) setPendingClaims(data.pendingClaims)
        if (data.adminName) setAdminInfo({ name: data.adminName, email: data.adminEmail || '' })
      })
      .catch(() => { if (!cancelled) setAccess('unavailable') })

    return () => { cancelled = true }
  }, [loading])

  useEffect(() => {
    if (access === 'denied') router.replace('/home')
  }, [access, router])

  // Spinner until the server has answered.
  if (loading || access === 'checking') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#f7f7f8',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}>
        <div style={{
          width: 40, height: 40, border: '3px solid #e5e7eb',
          borderTopColor: '#335231', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  // The redirect is in progress; render nothing rather than a flash of admin.
  if (access === 'denied') return null

  // Reachable but not answerable: say so instead of bouncing someone who may
  // well be an admin looking at a blip.
  if (access === 'unavailable') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#f7f7f8', fontFamily: "'Inter', system-ui, sans-serif", padding: 24, textAlign: 'center',
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>The admin could not be reached</div>
        <div style={{ fontSize: 13, color: '#666' }}>Check your connection and try again.</div>
        <button
          onClick={() => { setAccess('checking'); router.refresh() }}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#335231', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          Try again
        </button>
      </div>
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
