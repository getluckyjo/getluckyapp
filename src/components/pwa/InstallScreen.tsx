'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import { useIsStandalone } from '@/hooks/useIsStandalone'
import { track } from '@/lib/analytics'
import { haptics } from '@/lib/haptics'
import { pwaAsset } from '@/lib/pwa/assets'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const APP_URL = 'https://www.getluckyholeinone.com/install'
const SHARE_TEXT = 'Get the Get Lucky app: back yourself to a hole-in-one on any par 3. Install it here (no app store needed):'

type Platform = 'ios-safari' | 'ios-other' | 'android' | 'desktop'

function detect(): Platform {
  const ua = navigator.userAgent
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (iOS) {
    const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram|Line\/|Twitter|WhatsApp/.test(ua)
    return safari ? 'ios-safari' : 'ios-other'
  }
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

const ShareIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
  </svg>
)
const PlusIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" />
  </svg>
)
const TickIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12l5 5L20 7" />
  </svg>
)
const MenuIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
  </svg>
)

/**
 * /install — the page you send someone who wants "the app".
 *
 * Android Chrome: one Install button that fires the real install dialog
 * (Chrome's beforeinstallprompt), with the menu route as fallback when the
 * event has not fired (Samsung Internet, already installed, page just
 * loaded). iPhone in Safari: the three taps, drawn. iPhone anywhere else
 * (Chrome, WhatsApp, Instagram): only Safari can install, so a Copy link
 * button and the instruction to paste it into Safari. Desktop: the QR
 * code to scan with a phone, plus a share button. Already installed: a
 * thank-you and a way into the app.
 */
export default function InstallScreen() {
  const router = useRouter()
  const standalone = useIsStandalone()
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // Detection needs the browser, so it runs after mount; deferred a tick so
    // the first paint is the server's HTML (react-hooks/set-state-in-effect).
    const t = window.setTimeout(() => {
      setPlatform(detect())
      track('pwa_install_prompt_shown', { platform: 'install_page' })
    }, 0)
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent) }
    const onInstalled = () => { setInstalled(true); setDeferred(null); track('pwa_install', { source: 'install_page' }) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function install() {
    if (!deferred) return
    haptics.tap()
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setDeferred(null)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(APP_URL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* the link is printed on screen anyway */ }
  }

  async function share() {
    haptics.tap()
    if (navigator.share) {
      try { await navigator.share({ title: 'Get Lucky', text: SHARE_TEXT, url: APP_URL }) } catch { /* cancelled */ }
    } else {
      copyLink()
    }
  }

  const done = standalone || installed

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />
        <div className="vf-scroll inst">
          <div className="inst-hero">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pwaAsset('/icons/icon-192.png')} alt="" width={72} height={72} className="inst-icon" />
            <h1 className="v2-title" style={{ marginBottom: 6 }}>{done ? 'You have\nthe app' : 'Get the\napp'}</h1>
            <p className="vf-sub" style={{ marginBottom: 0 }}>
              {done
                ? 'Get Lucky is on your home screen. Open it from there for the full-screen version.'
                : 'Three taps and Get Lucky sits on your home screen like any other app. No app store, no download size, and it keeps your place on the course.'}
            </p>
          </div>

          {done && (
            <button type="button" className="btn-lime btn-lime--block inst-cta" onClick={() => router.push('/home')}>
              Open Get Lucky
            </button>
          )}

          {!done && platform === 'android' && (
            <>
              {deferred ? (
                <button type="button" className="btn-lime btn-lime--block inst-cta" onClick={install}>
                  Install Get Lucky
                </button>
              ) : (
                <ol className="install-steps inst-steps">
                  <li><span className="install-step-icon"><MenuIcon /></span><span>Tap the <strong>three dots</strong> at the top right of Chrome</span></li>
                  <li><span className="install-step-icon"><PlusIcon /></span><span>Tap <strong>Add to Home screen</strong> (on some phones <strong>Install app</strong>)</span></li>
                  <li><span className="install-step-icon"><TickIcon /></span><span>Tap <strong>Install</strong></span></li>
                </ol>
              )}
              <p className="inst-note">Samsung Internet: menu → Add page to → Home screen.</p>
            </>
          )}

          {!done && platform === 'ios-safari' && (
            <>
              <ol className="install-steps inst-steps">
                <li><span className="install-step-icon"><ShareIcon /></span><span>Tap the <strong>Share</strong> button at the bottom of Safari</span></li>
                <li><span className="install-step-icon"><PlusIcon /></span><span>Scroll down and tap <strong>Add to Home Screen</strong></span></li>
                <li><span className="install-step-icon"><TickIcon /></span><span>Tap <strong>Add</strong> in the top corner</span></li>
              </ol>
              <p className="inst-note">Then open <strong>Get Lucky</strong> from your home screen and sign in once with the six-digit code from your email.</p>
            </>
          )}

          {!done && platform === 'ios-other' && (
            <>
              <div className="inst-warn">
                <strong>Open this page in Safari first.</strong>
                <span>On iPhone only Safari can add an app to the home screen. Chrome, WhatsApp, Instagram and Gmail open links in their own browser, which cannot.</span>
              </div>
              <button type="button" className="btn-lime btn-lime--block inst-cta" onClick={copyLink}>
                {copied ? 'Link copied' : 'Copy the link'}
              </button>
              <p className="inst-note">Then open Safari, paste the link in the address bar, and follow the three taps.</p>
              <p className="inst-url">{APP_URL}</p>
            </>
          )}

          {!done && platform === 'desktop' && (
            <>
              <div className="inst-qr">
                <Image src="/marketing/install-qr.svg" alt="QR code that opens the install page" width={220} height={220} unoptimized />
                <span>Scan with your phone&rsquo;s camera</span>
              </div>
              <p className="inst-note">Or send yourself the link and open it on your phone.</p>
              <button type="button" className="btn-tile btn-tile--block" onClick={copyLink}>
                {copied ? 'Link copied' : 'Copy the link'}
              </button>
              <p className="inst-url">{APP_URL}</p>
            </>
          )}

          {!done && platform && platform !== 'desktop' && (
            <button type="button" className="btn-tile btn-tile--block inst-share" onClick={share}>
              Share with a friend
            </button>
          )}

          <p className="inst-foot">
            Already have it? Look for the lime Get Lucky icon on your home screen.
            {' '}Questions: <a href="mailto:support@getluckygolf.co.za">support@getluckygolf.co.za</a>
          </p>
        </div>
      </div>
    </PhoneFrame>
  )
}
