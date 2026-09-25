'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, Menu, Shield } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

interface AdminTopBarProps {
  adminName?: string
  adminEmail?: string
  /** Opens the sidebar as a drawer; the button shows below 900 px wide only. */
  onMenu?: () => void
}

export default function AdminTopBar({ adminName, adminEmail, onMenu }: AdminTopBarProps) {
  const { signOut } = useAuth()
  const router = useRouter()
  const [leaving, setLeaving] = useState(false)

  // Sign out the way the app's Account screen does, then to the sign-in screen.
  async function logOut() {
    setLeaving(true)
    try { await signOut() } finally { router.replace('/auth') }
  }

  return (
    <header className="adm-top">
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="adm-icon-btn adm-menu-btn" onClick={onMenu} aria-label="Open the menu"><Menu size={18} /></button>
        <span className="adm-top-tag"><Shield size={17} aria-hidden /> Admin panel</span>
      </span>

      <div className="adm-top-who">
        <div className="adm-top-id">
          <div className="adm-top-name">{adminName || 'Admin'}</div>
          {adminEmail && <div className="adm-top-email">{adminEmail}</div>}
        </div>
        <div className="adm-avatar" aria-hidden>{(adminName || adminEmail || 'A').charAt(0).toUpperCase()}</div>
        <button type="button" onClick={logOut} disabled={leaving} className="adm-btn adm-btn--quiet">
          <LogOut size={14} aria-hidden /> {leaving ? 'Logging out…' : 'Log out'}
        </button>
      </div>
    </header>
  )
}
