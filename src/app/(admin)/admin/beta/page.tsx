'use client'

import { useEffect, useState } from 'react'
import { KeyRound, Mail, Trash2, Copy, Check } from 'lucide-react'
import ConfirmModal from '@/components/admin/ConfirmModal'
import LoadError from '@/components/admin/LoadError'
import type { BetaAccessKind } from '@/types/database'
import { sastDate } from '../bets/client-helpers'

interface Row { id: number; kind: BetaAccessKind; value: string; note: string | null; added_by: string | null; created_at: string }

const OFFLINE = 'Could not reach the server. Check your connection and try again.'

const shown = (r: Row) => (r.kind === 'code' ? r.value.toUpperCase() : r.value)

/**
 * Who may use the app while BETA_GATE=on. Add an email (they sign in with
 * it) or generate an invite code (they type it at /beta). Removing a row
 * locks that tester out on their next page view.
 */
export default function AdminBetaPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [gate, setGate] = useState<boolean | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [kind, setKind] = useState<BetaAccessKind>('email')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [removing, setRemoving] = useState<Row | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/beta')
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) { setLoadError(json.error ?? `The server answered ${res.status}.`); return }
        setLoadError(null)
        setRows(json.data ?? [])
        setGate(json.gate ?? null)
      })
      .catch(() => { if (!cancelled) setLoadError(OFFLINE) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [refresh])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/beta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, value: value.trim() || undefined, note: note.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? 'Could not add. Please try again.'); return }
      setValue('')
      setNote('')
      setRefresh(n => n + 1)
    } catch {
      setError(OFFLINE)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!removing) return
    setRemoveBusy(true)
    setRemoveError(null)
    try {
      const res = await fetch(`/api/admin/beta?id=${removing.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setRemoveError(json.error ?? 'Could not remove. Please try again.'); return }
      setRemoving(null)
      setRefresh(n => n + 1)
    } catch {
      setRemoveError(OFFLINE)
    } finally {
      setRemoveBusy(false)
    }
  }

  async function copy(row: Row) {
    try {
      await navigator.clipboard.writeText(row.value.toUpperCase())
      setCopied(row.id)
      setTimeout(() => setCopied(null), 1500)
    } catch { /* clipboard blocked; the value is visible anyway */ }
  }

  return (
    <div>
      <title>Beta testers · Get Lucky admin</title>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">Beta testers</h1>
          <p className="adm-lead">Who may use the app while the closed beta is on. Changes apply on the tester&rsquo;s next page view.</p>
        </div>
        {gate !== null && (
          <span className={gate ? 'adm-pill adm-pill--lime' : 'adm-pill'}>Gate {gate ? 'on' : 'off'} (BETA_GATE)</span>
        )}
      </div>

      <form onSubmit={add} className="adm-card adm-card--form adm-row" style={{ marginBottom: 16 }}>
        <label className="adm-field">
          Kind
          <select value={kind} onChange={e => setKind(e.target.value as BetaAccessKind)} className="adm-input">
            <option value="email">Email address</option>
            <option value="code">Invite code</option>
          </select>
        </label>
        <label className="adm-field" style={{ flex: '1 1 240px' }}>
          {kind === 'email' ? 'Email' : 'Code'}
          <input
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={kind === 'email' ? 'golfer@example.com' : 'Leave blank to generate one'}
            type={kind === 'email' ? 'email' : 'text'}
            required={kind === 'email'}
            minLength={kind === 'code' ? 4 : undefined}
            maxLength={kind === 'code' ? 40 : 200}
            className="adm-input"
          />
        </label>
        <label className="adm-field" style={{ flex: '1 1 220px' }}>
          Note
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Who, which club" maxLength={200} className="adm-input" />
        </label>
        <button type="submit" disabled={busy} className="adm-btn">
          {busy ? 'Adding…' : kind === 'email' ? 'Add email' : 'Create code'}
        </button>
        {error && <p role="alert" className="adm-error" style={{ margin: 0, flexBasis: '100%' }}>{error}</p>}
      </form>

      {loadError ? (
        <LoadError what="The beta list" onRetry={() => { setLoadError(null); setLoaded(false); setRefresh(n => n + 1) }} detail={loadError} />
      ) : (
        <div className="adm-card">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Email or code</th>
                  <th>Note</th>
                  <th className="adm-num">Added</th>
                  <th style={{ textAlign: 'right' }}>Remove</th>
                </tr>
              </thead>
              <tbody>
                {!loaded ? (
                  <tr><td colSpan={5} className="adm-muted">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="adm-muted" style={{ padding: 28, textAlign: 'center' }}>Nobody on the list yet. With the gate on, nobody could use the app, admins included.</td></tr>
                ) : rows.map(r => (
                  <tr key={r.id}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {r.kind === 'email' ? <Mail size={14} aria-hidden /> : <KeyRound size={14} aria-hidden />} {r.kind === 'email' ? 'Email' : 'Code'}
                      </span>
                    </td>
                    <td>
                      <span className={r.kind === 'code' ? 'adm-mono' : undefined} style={{ fontWeight: 600 }}>{shown(r)}</span>
                      {r.kind === 'code' && (
                        <button type="button" onClick={() => copy(r)} className="adm-icon-btn" aria-label={`Copy code ${shown(r)}`} title="Copy" style={{ width: 28, height: 28, marginLeft: 8, verticalAlign: 'middle' }}>
                          {copied === r.id ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      )}
                    </td>
                    <td className="adm-muted">{r.note ?? ''}</td>
                    <td className="adm-num adm-muted">{sastDate(r.created_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" onClick={() => { setRemoveError(null); setRemoving(r) }} className="adm-icon-btn adm-icon-btn--warn" aria-label={`Remove ${shown(r)}`} title="Remove">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="adm-small" style={{ marginTop: 12 }}>
        Turn the gate on by setting <code>BETA_GATE=on</code> in Vercel (Production or Preview) and redeploying. Admin accounts are not exempt: add your own email first.
      </p>

      <ConfirmModal
        open={removing !== null}
        title={`Remove ${removing ? shown(removing) : ''}?`}
        message={removing?.kind === 'code'
          ? 'Anyone who got in with this code loses access on their next page view, and it stops working at /beta.'
          : 'They lose access on their next page view while the gate is on.'}
        confirmLabel="Remove"
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
        busy={removeBusy}
        error={removeError}
      />
    </div>
  )
}
