'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { getInitials } from '@/lib/format'

/**
 * Burger-menu drawer. The tab bar carries the five main surfaces; this holds
 * everything the V2 designs took off the tab bar and the home screen — bet
 * history, how it works, membership, legal — plus who's signed in.
 * The page you're on is picked out in lime.
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
  { label: 'Terms & conditions', path: '/terms' },
  { label: 'Privacy policy',   path: '/privacy' },
  { label: 'Responsible play', path: '/responsible-play' },
]

export default function AppMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, profile, signOut } = useAuth()

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

  const displayName = profile?.name ?? user?.user_metadata?.full_name ?? null
  const isCurrent = (path: string) => pathname === path || (path !== '/home' && pathname?.startsWith(path + '/'))

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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <nav className="app-menu-primary" aria-label="Menu">
          {PRIMARY.map(item => (
            <button
              key={item.path}
              type="button"
              className={isCurrent(item.path) ? 'is-current' : undefined}
              aria-current={isCurrent(item.path) ? 'page' : undefined}
              onClick={() => go(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <nav className="app-menu-secondary" aria-label="More">
          {SECONDARY.map(item => (
            <button
              key={item.path}
              type="button"
              className={isCurrent(item.path) ? 'is-current' : undefined}
              aria-current={isCurrent(item.path) ? 'page' : undefined}
              onClick={() => go(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="app-menu-foot">
          {user ? (
            <>
              <button type="button" className="app-menu-user" onClick={() => go('/account')}>
                <span className="app-menu-avatar" aria-hidden>{getInitials(displayName, user.email)}</span>
                <span className="app-menu-user-text">
                  <span className="app-menu-user-name">{displayName ?? 'Golfer'}</span>
                  <span className="app-menu-user-email">{user.email}</span>
                </span>
              </button>
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
            <>
              <button type="button" className="btn-lime" onClick={() => go('/auth')}>
                Sign in
              </button>
              <p className="app-menu-hint">
                New here? <button type="button" onClick={() => go('/onboarding')}>See how it works</button>
              </p>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
