'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { TURNSTILE_SCRIPT_URL } from '@/lib/auth/turnstile'

/** The part of Cloudflare's API the widget uses (https://developers.cloudflare.com/turnstile/). */
interface TurnstileApi {
  render: (el: HTMLElement, opts: {
    sitekey: string
    theme?: 'light' | 'dark' | 'auto'
    size?: 'normal' | 'compact' | 'flexible'
    callback?: (token: string) => void
    'expired-callback'?: () => void
    'error-callback'?: () => void
  }) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT_ID = 'cf-turnstile-script'

/** Load the script once; resolve when window.turnstile is there. */
function loadTurnstile(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) { resolve(window.turnstile); return }
    let tag = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (!tag) {
      tag = document.createElement('script')
      tag.id = SCRIPT_ID
      tag.src = `${TURNSTILE_SCRIPT_URL}?render=explicit`
      tag.async = true
      tag.defer = true
      document.head.appendChild(tag)
    }
    const done = () => { if (window.turnstile) resolve(window.turnstile); else reject(new Error('turnstile did not load')) }
    tag.addEventListener('load', done, { once: true })
    tag.addEventListener('error', () => reject(new Error('turnstile script failed')), { once: true })
  })
}

export interface TurnstileHandle {
  /** Clear the widget and its token, after a token has been used (each one is good once). */
  reset: () => void
}

/**
 * Cloudflare's Turnstile widget, compact and in the dark theme for the
 * green sign-in screen. Gives the token to `onToken`, and null when it
 * expires or fails, so the screen knows whether it has one to send.
 */
const Turnstile = forwardRef<TurnstileHandle, { siteKey: string; onToken: (token: string | null) => void }>(function Turnstile({ siteKey, onToken }, ref) {
  const el = useRef<HTMLDivElement>(null)
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useImperativeHandle(ref, () => ({
    reset: () => {
      widget.current?.api.reset(widget.current.id)
      onTokenRef.current(null)
    },
  }), [])

  useEffect(() => {
    let cancelled = false
    loadTurnstile()
      .then(api => {
        if (cancelled || !el.current) return
        const id = api.render(el.current, {
          sitekey: siteKey,
          theme: 'dark',
          size: 'compact',
          callback: token => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        })
        widget.current = { api, id }
      })
      .catch(() => { /* no widget: the sign-in goes without a token, and Supabase says if one was needed */ })
    return () => {
      cancelled = true
      try { widget.current?.api.remove(widget.current.id) } catch { /* already gone */ }
      widget.current = null
    }
  }, [siteKey])

  return <div ref={el} className="signin-turnstile" />
})

export default Turnstile
