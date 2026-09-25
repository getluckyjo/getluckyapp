'use client'

import { AlertTriangle, RotateCw } from 'lucide-react'

/**
 * What an admin page shows when its data could not be loaded, instead of an
 * empty list. "No claims to review" after a 500 reads as all clear, and
 * "No golf days yet" invites making a duplicate; this says what happened.
 */
export default function LoadError({ what = 'This', onRetry, detail }: {
  /** What failed to load, as a noun phrase: "The claims". */
  what?: string
  onRetry?: () => void
  /** The server's error message, when there is one. */
  detail?: string | null
}) {
  return (
    <div role="alert" className="adm-card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', border: '2px solid #f3c7c7' }}>
      <span aria-hidden className="adm-icon-btn" style={{ background: '#fde8e8', color: 'var(--red)', cursor: 'default' }}>
        <AlertTriangle size={18} />
      </span>
      <div style={{ flex: '1 1 240px' }}>
        <div className="adm-h3">{what} could not be loaded</div>
        <div className="adm-small">{detail || 'Check your connection, then try again. Nothing has changed.'}</div>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="adm-btn adm-btn--quiet">
          <RotateCw size={14} aria-hidden /> Try again
        </button>
      )}
    </div>
  )
}
