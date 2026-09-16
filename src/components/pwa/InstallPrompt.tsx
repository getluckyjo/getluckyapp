'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useIsStandalone } from '@/hooks/useIsStandalone'
import { track } from '@/lib/analytics'
import { haptics } from '@/lib/haptics'
import { pwaAsset } from '@/lib/pwa/assets'

/** The Chrome event that lets a page trigger the install dialog itself. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'gl_install_dismissed_at'
const INSTALLED_KEY = 'gl_installed'
const SEEN_PATHS_KEY = 'gl_seen_paths'
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
const SHOW_DELAY_MS = 1500

/** Screens where a prompt would interrupt something that matters. Never here. */
const QUIET_PATHS = ['/', '/splash', '/onboarding', '/auth', '/age-check', '/welcome', '/select-course', '/choose-stake', '/payment-return', '/record', '/confirm', '/result', '/admin', '/witness', '/~offline', '/beta', '/terms', '/privacy', '/responsible-play', '/install']
/** One visit to any of these counts as a meaningful interaction on its own. */
const ENGAGED_PATHS = ['/leaderboard', '/history', '/verify', '/icons']
/** Otherwise, this many distinct screens in one session. */
const ENGAGED_DISTINCT = 3

function storage<T>(fn: () => T, fallback: T): T {
  try { return fn() } catch { return fallback }
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!iOS) return false
  // Chrome, Firefox, Edge and in-app browsers on iOS cannot add to the home screen.
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram|Line\//.test(ua)
}

/**
 * Install prompts, both platforms, one component.
 *
 * Android/Chrome: the `beforeinstallprompt` event is captured and its
 * default banner suppressed. iOS Safari has no API, so it gets a sheet with
 * the three taps. Neither shows on first paint: only after a meaningful
 * interaction (a visit to Winners, My bets, Club or the claim tracker, or
 * three distinct screens in one session), never on a money screen, never
 * when already installed, and not again for seven days after "Not now".
 */
export default function InstallPrompt() {
  const pathname = usePathname()
  const standalone = useIsStandalone()
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [engaged, setEngaged] = useState(false)
  const [mode, setMode] = useState<'android' | 'ios' | null>(null)

  // 1. Capture Chrome's event and keep it for later.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      storage(() => localStorage.setItem(INSTALLED_KEY, '1'), undefined)
      setMode(null)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // 2. Notice engagement as the golfer moves through the app.
  useEffect(() => {
    if (!pathname) return
    const seen = new Set<string>(storage(() => JSON.parse(sessionStorage.getItem(SEEN_PATHS_KEY) ?? '[]') as string[], []))
    seen.add(pathname)
    storage(() => sessionStorage.setItem(SEEN_PATHS_KEY, JSON.stringify([...seen])), undefined)
    if (ENGAGED_PATHS.some(p => pathname.startsWith(p)) || seen.size >= ENGAGED_DISTINCT) {
      const t = window.setTimeout(() => setEngaged(true), 0)
      return () => window.clearTimeout(t)
    }
  }, [pathname])

  // 3. Decide whether, and which, to show.
  useEffect(() => {
    if (!engaged || standalone || mode) return
    if (!pathname || QUIET_PATHS.some(p => pathname === p || (p !== '/' && pathname.startsWith(p)))) return
    if (storage(() => localStorage.getItem(INSTALLED_KEY), null) === '1') return
    const dismissedAt = Number(storage(() => localStorage.getItem(DISMISSED_KEY), null) ?? 0)
    if (dismissedAt && Date.now() - dismissedAt < COOLDOWN_MS) return

    const next: 'android' | 'ios' | null = deferred ? 'android' : isIosSafari() ? 'ios' : null
    if (!next) return
    const t = window.setTimeout(() => {
      setMode(next)
      track('pwa_install_prompt_shown', { platform: next })
    }, SHOW_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [engaged, standalone, mode, pathname, deferred])

  function dismiss() {
    storage(() => localStorage.setItem(DISMISSED_KEY, String(Date.now())), undefined)
    track('pwa_install_prompt_dismissed', { platform: mode ?? 'unknown' })
    setMode(null)
  }

  async function install() {
    if (!deferred) return
    haptics.tap()
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') {
      setMode(null)
    } else {
      dismiss()
    }
    setDeferred(null)
  }

  if (!mode) return null

  if (mode === 'android') {
    return (
      <div className="install-card" role="dialog" aria-label="Install Get Lucky">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pwaAsset('/icons/icon-192.png')} alt="" width={48} height={48} className="install-card-icon" />
        <div className="install-card-text">
          <strong>Add Get Lucky to your home screen</strong>
          <span>Opens full screen, loads faster, and keeps your place on the course.</span>
        </div>
        <div className="install-card-actions">
          <button type="button" className="install-btn-ghost" onClick={dismiss}>Not now</button>
          <button type="button" className="install-btn" onClick={install}>Install</button>
        </div>
      </div>
    )
  }

  return (
    <div className="install-sheet-backdrop" onClick={dismiss}>
      <div className="install-sheet" role="dialog" aria-modal="true" aria-label="Add Get Lucky to your home screen" onClick={e => e.stopPropagation()}>
        <div className="install-sheet-grip" aria-hidden />
        <h2 className="install-sheet-title">Put Get Lucky on your home screen</h2>
        <p className="install-sheet-sub">Three taps in Safari. It then opens like any other app.</p>
        <ol className="install-steps">
          <li>
            <span className="install-step-icon" aria-hidden>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
              </svg>
            </span>
            <span>Tap the <strong>Share</strong> button at the bottom of Safari</span>
          </li>
          <li>
            <span className="install-step-icon" aria-hidden>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" />
              </svg>
            </span>
            <span>Scroll down and tap <strong>Add to Home Screen</strong></span>
          </li>
          <li>
            <span className="install-step-icon" aria-hidden>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
            </span>
            <span>Tap <strong>Add</strong> in the top corner</span>
          </li>
        </ol>
        <button type="button" className="btn-lime install-sheet-done" onClick={dismiss}>Got it</button>
      </div>
    </div>
  )
}
