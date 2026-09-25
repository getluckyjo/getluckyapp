'use client'

import { useState, useSyncExternalStore } from 'react'
import { useIsStandalone } from '@/hooks/useIsStandalone'
import { track } from '@/lib/analytics'
import { haptics } from '@/lib/haptics'
import {
  SERVER_INSTALL_STATE, detectPlatform, installState, promptInstall, subscribeInstall,
  type InstallState, type Platform,
} from '@/lib/pwa/install'
import { MenuIcon, PlusIcon, ShareIcon, TickIcon } from './install-icons'

const never = () => () => {}

/** This browser's install route; null while server-rendered. */
export function usePlatform(): Platform | null {
  return useSyncExternalStore(
    never,
    () => detectPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    () => null,
  )
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribeInstall, installState, () => SERVER_INSTALL_STATE)
}

/** Worth offering: a phone, in a browser, not installed yet. */
export function useCanOfferInstall(): boolean {
  const standalone = useIsStandalone()
  const platform = usePlatform()
  const { installed } = useInstallState()
  return !standalone && !installed && platform !== null && platform !== 'desktop'
}

/**
 * "Put Get Lucky on your home screen", as a pop-up a screen opens at the
 * right moment (the golf day screen opens it the moment a player joins).
 *
 * Android Chrome with its install dialog in hand: one button that opens it.
 * Android without it (Samsung Internet, WhatsApp's browser, Chrome still
 * deciding): the menu route. iPhone Safari: the three taps. iPhone anywhere
 * else: open this page in Safari first, with a Copy link button.
 */
export default function AddToHomeSheet({ title, lead, source, onClose }: {
  title: string
  lead: string
  /** For analytics: which screen offered it. */
  source: string
  onClose: () => void
}) {
  const platform = usePlatform()
  const { canPrompt, installed } = useInstallState()
  const [copied, setCopied] = useState(false)

  async function install() {
    haptics.tap()
    const outcome = await promptInstall()
    if (outcome === 'accepted') {
      track('pwa_install', { source })
      onClose()
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* the link is in the address bar anyway */ }
  }

  const android = platform === 'android'

  return (
    <div className="install-sheet-backdrop" onClick={onClose}>
      <div className="install-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="install-sheet-grip" aria-hidden />
        <h2 className="install-sheet-title">{installed ? 'On your home screen' : title}</h2>
        <p className="install-sheet-sub">{installed ? 'Open Get Lucky from your home screen, like any other app.' : lead}</p>

        {!installed && android && canPrompt && (
          <button type="button" className="btn-lime install-sheet-done" onClick={install}>Add to home screen</button>
        )}

        {!installed && android && !canPrompt && (
          <>
            <ol className="install-steps">
              <li><span className="install-step-icon"><MenuIcon /></span><span>Tap the <strong>three dots</strong> at the top right</span></li>
              <li><span className="install-step-icon"><PlusIcon /></span><span>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong></span></li>
              <li><span className="install-step-icon"><TickIcon /></span><span>Tap <strong>Install</strong></span></li>
            </ol>
            <p className="inst-note">Opened from WhatsApp? Tap the three dots, then <strong>Open in Chrome</strong> first.</p>
          </>
        )}

        {!installed && platform === 'ios-safari' && (
          <>
            <ol className="install-steps">
              <li><span className="install-step-icon"><ShareIcon /></span><span>Tap the <strong>Share</strong> button at the bottom of Safari</span></li>
              <li><span className="install-step-icon"><PlusIcon /></span><span>Scroll down and tap <strong>Add to Home Screen</strong></span></li>
              <li><span className="install-step-icon"><TickIcon /></span><span>Tap <strong>Add</strong> in the top corner</span></li>
            </ol>
            <p className="inst-note">Then open <strong>Get Lucky</strong> from your home screen and sign in once more with the six-digit code from your email.</p>
          </>
        )}

        {!installed && platform === 'ios-other' && (
          <>
            <div className="inst-warn">
              <strong>Open this page in Safari first.</strong>
              <span>On iPhone only Safari can add an app to the home screen. WhatsApp, Chrome and Instagram open links in their own browser, which cannot.</span>
            </div>
            <button type="button" className="btn-lime install-sheet-done" onClick={copyLink}>{copied ? 'Link copied' : 'Copy the link'}</button>
            <p className="inst-note" style={{ marginTop: 12 }}>Paste it into Safari, then tap Share and <strong>Add to Home Screen</strong>.</p>
          </>
        )}

        <button
          type="button"
          className={installed || platform === 'ios-safari' ? 'btn-lime install-sheet-done' : 'btn-tile btn-tile--block gd-sheet-later'}
          onClick={onClose}
        >
          {installed ? 'Done' : platform === 'ios-safari' ? 'Got it' : 'Not now'}
        </button>
      </div>
    </div>
  )
}
