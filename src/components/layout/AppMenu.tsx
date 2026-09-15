'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'

/**
 * Burger-menu drawer. The tab bar carries the five main surfaces; this holds
 * everything the V2 designs took off the tab bar and the home screen — bet
 * history, how it works, membership, legal — plus sign in / sign out.
 */
const PRIMARY = [
  { label: 'Home',        path: '/home' },
  { label: 'Play',        path: '/select-course' },
  { label: 'My bets',     path: '/history' },
  { label: 'Winners',     path: '/leaderboard' },
  { label: 'Club',        path: '/membership' },
  { label: 'Account',     path: '/account' },
]

const SECONDARY = [
  { label: 'How it works',     path: '/onboarding' },
  { label: 'Terms of service', path: '/terms' },
  { label: 'Privacy policy',   path: '/privacy' },
  { label: 'Responsible play', path: '/responsible-play' },
]

export default function AppMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { user, signOut } = useAuth()

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function go(path: string) {
    onClose()
    router.push(path)
  }

  return (
    <div className="app-menu-backdrop" onClick={onClose}>
      <aside
        className="app-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        onClick={e => e.stopPropagation()}
      >
        <div className="app-menu-top">
          <img src="/brand/logo-corner.svg" alt="Get Lucky" className="app-menu-logo" draggable={false} />
          <button type="button" className="app-menu-close" aria-label="Close menu" onClick={onClose}>
            ×
          </button>
        </div>

        <nav className="app-menu-primary" aria-label="Menu">
          {PRIMARY.map(item => (
            <button key={item.path} type="button" onClick={() => go(item.path)}>
              {item.label}
            </button>
          ))}
        </nav>

        <nav className="app-menu-secondary" aria-label="More">
          {SECONDARY.map(item => (
            <button key={item.path} type="button" onClick={() => go(item.path)}>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="app-menu-foot">
          {user ? (
            <>
              <div className="app-menu-user">{user.email}</div>
              <button
                type="button"
                className="app-menu-signout"
                onClick={async () => {
                  onClose()
                  await signOut()
                  router.push('/splash')
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className="btn-lime" onClick={() => go('/auth')}>
              Sign in
            </button>
          )}
        </div>
      </aside>
    </div>
  )
}
