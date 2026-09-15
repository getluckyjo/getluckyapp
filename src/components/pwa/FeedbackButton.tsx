'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useIsStandalone } from '@/hooks/useIsStandalone'
import { track } from '@/lib/analytics'
import { haptics } from '@/lib/haptics'
import { APP_VERSION, BUILD_DATE } from '@/lib/version'

/** Screens where a floating button would sit on top of something that matters. */
const HIDDEN_ON = ['/record', '/admin', '/witness', '/~offline', '/payment-return', '/auth/callback']

/**
 * The always-there way to tell us something. A small floating button on
 * every screen (except the camera, admin and a few others) opens a sheet
 * with one textarea. The submission carries the route, build, display
 * mode and screen size, so a "the button did nothing" report is already
 * half diagnosed.
 */
export default function FeedbackButton() {
  const pathname = usePathname()
  const standalone = useIsStandalone()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  if (!pathname || HIDDEN_ON.some(p => pathname.startsWith(p))) return null

  function openSheet() {
    haptics.tap()
    setState('idle')
    setOpen(true)
  }

  function close() {
    setOpen(false)
    if (state === 'sent') setMessage('')
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim() || state === 'sending') return
    setState('sending')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          route: pathname,
          standalone,
          appVersion: APP_VERSION,
          buildDate: BUILD_DATE,
          screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`,
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      haptics.success()
      track('feedback_sent')
      setState('sent')
    } catch {
      haptics.warn()
      setState('error')
    }
  }

  return (
    <>
      <button type="button" className="fb-fab" onClick={openSheet} aria-label="Send feedback">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.2A8 8 0 1 1 21 12z" />
        </svg>
      </button>

      {open && (
        <div className="install-sheet-backdrop" onClick={close}>
          <div className="install-sheet fb-sheet" role="dialog" aria-modal="true" aria-label="Send feedback" onClick={e => e.stopPropagation()}>
            <div className="install-sheet-grip" aria-hidden />
            {state === 'sent' ? (
              <>
                <h2 className="install-sheet-title">Thank you</h2>
                <p className="install-sheet-sub">Your note is on its way to the team. It goes straight to a person, not a queue.</p>
                <button type="button" className="btn-lime install-sheet-done" onClick={close}>Done</button>
              </>
            ) : (
              <form onSubmit={send}>
                <h2 className="install-sheet-title">Tell us what happened</h2>
                <p className="install-sheet-sub">A bug, a confusing screen, an idea. We read every one.</p>
                <label className="sr-only" htmlFor="fb-message">Your feedback</label>
                <textarea
                  id="fb-message"
                  className="fb-textarea"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="What were you doing, and what did you expect?"
                  rows={5}
                  maxLength={4000}
                  autoFocus
                />
                {state === 'error' && <p className="beta-error" role="alert">Could not send. Check your connection and try again.</p>}
                <p className="fb-meta">Sent with: {pathname} · build {APP_VERSION} · {standalone ? 'installed app' : 'browser'}</p>
                <div className="fb-actions">
                  <button type="button" className="install-btn-ghost" onClick={close}>Cancel</button>
                  <button type="submit" className="install-btn" disabled={!message.trim() || state === 'sending'}>
                    {state === 'sending' ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
