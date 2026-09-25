'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

/** What any admin page shows when it throws while rendering, inside the admin's own frame. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[AdminError]', error)
  }, [error])

  return (
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, minHeight: '50vh', padding: 24, textAlign: 'center' }}>
      <title>Something went wrong · Get Lucky admin</title>
      <span aria-hidden className="adm-icon-btn" style={{ width: 56, height: 56, background: '#fde8e8', color: 'var(--red)', cursor: 'default' }}>
        <AlertTriangle size={26} />
      </span>
      <h1 className="adm-title" style={{ margin: 0 }}>Something went wrong on this page</h1>
      <p className="adm-lead" style={{ maxWidth: 440 }}>
        Nothing you saved has been lost. Try again, or open another page from the menu.
        {error.digest && <span className="adm-small" style={{ display: 'block', marginTop: 8 }}>Reference: <span className="adm-mono">{error.digest}</span></span>}
      </p>
      <button type="button" onClick={reset} className="adm-btn">
        <RotateCw size={17} aria-hidden /> Try again
      </button>
    </div>
  )
}
