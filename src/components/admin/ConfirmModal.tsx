'use client'

import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  variant?: 'danger' | 'success'
  onConfirm: () => void
  onCancel: () => void
  children?: React.ReactNode
  /** The request is on its way: both buttons wait, and Escape or a click outside does nothing. */
  busy?: boolean
  /** The confirm button is greyed out (say why in `children`, e.g. an unticked checklist). */
  confirmDisabled?: boolean
  /** Why the last attempt failed, shown inside the modal rather than behind it. */
  error?: string | null
}

/** A yes-or-no before something that can't be undone. Escape or a click outside cancels, unless it is busy. */
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  variant = 'danger',
  onConfirm,
  onCancel,
  children,
  busy = false,
  confirmDisabled = false,
  error = null,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open || busy) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onCancel])

  if (!open) return null
  const danger = variant === 'danger'

  return (
    <div className="adm-modal-back" onClick={() => { if (!busy) onCancel() }}>
      <div className="adm-modal" role="dialog" aria-modal="true" aria-labelledby="adm-confirm-title" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
          <span className={`adm-icon-btn${danger ? ' adm-icon-btn--warn' : ' adm-icon-btn--ok'}`} style={{ cursor: 'default', background: danger ? '#fde8e8' : undefined, color: danger ? 'var(--red)' : undefined }} aria-hidden>
            {danger ? <AlertTriangle size={19} /> : <CheckCircle2 size={19} />}
          </span>
          <div>
            <h2 id="adm-confirm-title" className="adm-h2" style={{ marginBottom: 6 }}>{title}</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, opacity: 0.85 }}>{message}</p>
          </div>
        </div>

        {children && <div style={{ marginBottom: 18 }}>{children}</div>}

        {error && <p role="alert" className="adm-error" style={{ margin: '0 0 14px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button type="button" onClick={onCancel} disabled={busy} className="adm-btn adm-btn--quiet">Cancel</button>
          {/* Not autofocused: Enter must never confirm by accident. */}
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            aria-busy={busy}
            className="adm-btn"
            style={danger ? { background: 'var(--red)', color: 'var(--white)', boxShadow: '3px 4px 0 var(--green-dark)' } : undefined}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
