'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

/**
 * Last-resort error boundary for the root layout. Reports to Sentry and shows
 * a plain page; the styled per-segment error.tsx files handle everything
 * above this.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { Sentry.captureException(error) }, [error])

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 32, background: '#ebedea', color: '#1e3120' }}>
        <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>Something went wrong</h1>
        <p style={{ margin: '0 0 20px' }}>The error has been reported. Please reload the page.</p>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: '10px 18px', fontSize: 16 }}>
          Reload
        </button>
      </body>
    </html>
  )
}
