'use client'

import { useEffect, useState } from 'react'
import { Copy, Check, Pencil, Power, Trash2, X } from 'lucide-react'
import ConfirmModal from '@/components/admin/ConfirmModal'
import LoadError from '@/components/admin/LoadError'
import type { AdminPromo, PromoStatus } from '@/lib/promo'

const SAST = 'Africa/Johannesburg'
const DAY = 24 * 3_600_000

/** The day a golfer in South Africa would read, as YYYY-MM-DD. */
function sastDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: SAST })
}

/** A code picked "until 31 Oct" works to the end of that day in South Africa (UTC+2, no daylight saving). */
function endOfSastDay(date: string): string {
  return new Date(`${date}T23:59:59+02:00`).toISOString()
}

function showDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { timeZone: SAST, day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS: Record<PromoStatus, { label: string; pill: string }> = {
  active:   { label: 'Active',  pill: 'adm-pill adm-pill--lime' },
  used_up:  { label: 'Used up', pill: 'adm-pill adm-pill--amber' },
  expired:  { label: 'Expired', pill: 'adm-pill' },
  disabled: { label: 'Off',     pill: 'adm-pill adm-pill--red' },
}

type Sent<T> = { ok: true; data: T } | { ok: false; error: string }

/** A change to a code, and what the server answered. Never throws: a dropped connection is an answer too. */
async function send<T>(url: string, method: string, body?: unknown): Promise<Sent<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json.error ?? 'That did not work. Please try again.' }
    return { ok: true, data: json.data as T }
  } catch {
    return { ok: false, error: 'That did not reach the server. Check your connection, then try again.' }
  }
}

interface Editing { id: string; maxUses: string; expires: string; note: string }

/**
 * Promo codes: each one is an extra free swing per golfer, up to its limit
 * and until its date. Golfers type it on the stake screen. Switching a
 * code off stops it at once; a code nobody has played can be deleted.
 */
export default function AdminPromosPage() {
  const [attempt, setAttempt] = useState(0)
  // rows null: the list could not be loaded (never shown as "no codes").
  const [list, setList] = useState<{ attempt: number; rows: AdminPromo[] | null; detail: string | null } | null>(null)
  const [code, setCode] = useState('')
  const [maxUses, setMaxUses] = useState('50')
  const [expires, setExpires] = useState(() => sastDate(new Date(Date.now() + 30 * DAY).toISOString()))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The code just made, shown until the next one so it can be copied and sent.
  const [created, setCreated] = useState<AdminPromo | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ action: 'off' | 'delete'; row: AdminPromo } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/promos', { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (cancelled) return
        setList(res.ok && Array.isArray(json?.data) ? { attempt, rows: json.data, detail: null } : { attempt, rows: null, detail: json?.error ?? null })
      })
      .catch(() => { if (!cancelled) setList({ attempt, rows: null, detail: null }) })
    return () => { cancelled = true }
  }, [attempt])

  const loading = list?.attempt !== attempt
  const rows = loading ? null : list.rows
  const today = sastDate(new Date().toISOString())

  /** Put the server's copy of a code into the list, keeping the counts only the list works out. */
  function replace(next: AdminPromo) {
    setList(l => (l?.rows ? { ...l, rows: l.rows.map(r => (r.id === next.id ? { ...next, claimed: r.claimed, converted: r.converted } : r)) } : l))
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const sent = await send<AdminPromo>('/api/admin/promos', 'POST', {
      code: code.trim() || undefined,
      maxUses: Number(maxUses),
      expiresAt: endOfSastDay(expires),
      note: note.trim() || undefined,
    })
    setBusy(false)
    if (!sent.ok) { setError(sent.error); return }
    setList(l => (l?.rows ? { ...l, rows: [sent.data, ...l.rows] } : l))
    setCreated(sent.data)
    setCode('')
    setNote('')
  }

  function startEdit(r: AdminPromo) {
    setEditError(null)
    setEditing({ id: r.id, maxUses: String(r.maxUses), expires: sastDate(r.expiresAt), note: r.note ?? '' })
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    const row = rows?.find(r => r.id === editing?.id)
    if (!editing || !row) return
    // Only what changed: an expired code keeps its date unless a new one is picked.
    const body: Record<string, unknown> = {}
    if (Number(editing.maxUses) !== row.maxUses) body.maxUses = Number(editing.maxUses)
    if (editing.expires !== sastDate(row.expiresAt)) body.expiresAt = endOfSastDay(editing.expires)
    if ((editing.note.trim() || null) !== row.note) body.note = editing.note.trim() || null
    if (Object.keys(body).length === 0) { setEditing(null); return }

    setEditError(null)
    setEditBusy(true)
    const sent = await send<AdminPromo>(`/api/admin/promos/${row.id}`, 'PATCH', body)
    setEditBusy(false)
    if (!sent.ok) { setEditError(sent.error); return }
    replace(sent.data)
    setEditing(null)
  }

  async function switchOn(r: AdminPromo) {
    setError(null)
    const sent = await send<AdminPromo>(`/api/admin/promos/${r.id}`, 'PATCH', { disabled: false })
    if (sent.ok) replace(sent.data)
    else setError(sent.error)
  }

  async function confirm() {
    if (!confirming) return
    const { action, row } = confirming
    setConfirmError(null)
    setConfirmBusy(true)
    const sent = action === 'off'
      ? await send<AdminPromo>(`/api/admin/promos/${row.id}`, 'PATCH', { disabled: true })
      : await send<unknown>(`/api/admin/promos/${row.id}`, 'DELETE')
    setConfirmBusy(false)
    if (!sent.ok) { setConfirmError(sent.error); return }
    if (action === 'off') replace(sent.data as AdminPromo)
    else setList(l => (l?.rows ? { ...l, rows: l.rows.filter(r => r.id !== row.id) } : l))
    if (created?.id === row.id && action === 'delete') setCreated(null)
    setConfirming(null)
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    } catch { /* clipboard blocked; the code is on screen to copy by hand */ }
  }

  return (
    <div>
      <title>Promo codes · Get Lucky admin</title>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">Promo codes</h1>
          <p className="adm-lead">
            Each code is one extra free swing per golfer, up to its limit and until the end of its expiry date (South African time).
            Golfers type it under &ldquo;Have a promo code?&rdquo; on the stake screen.
          </p>
        </div>
      </div>

      <form onSubmit={create} className="adm-card adm-card--form">
        <h2 className="adm-h2" style={{ marginBottom: 14 }}>New code</h2>
        <div className="adm-row">
          <label className="adm-field">
            Code
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Leave blank to generate" maxLength={40} className="adm-input adm-mono" style={{ minWidth: 210 }} />
          </label>
          <label className="adm-field">
            Uses in total
            <input type="number" min={1} max={100000} required value={maxUses} onChange={e => setMaxUses(e.target.value)} className="adm-input" style={{ width: 120 }} />
          </label>
          <label className="adm-field">
            Works until
            <input type="date" required value={expires} min={today} onChange={e => setExpires(e.target.value)} className="adm-input" />
          </label>
          <label className="adm-field" style={{ flex: '1 1 260px' }}>
            Note
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Where it is going, e.g. Zimbali club day" maxLength={200} className="adm-input" />
          </label>
          <button type="submit" disabled={busy} className="adm-btn">{busy ? 'Creating…' : 'Create code'}</button>
        </div>
        {error && <p role="alert" className="adm-error" style={{ margin: '12px 0 0' }}>{error}</p>}
        {created && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16, padding: '12px 14px', borderRadius: 12, background: 'var(--surface)' }}>
            <span className="adm-pill adm-pill--lime"><Check size={13} aria-hidden /> Made</span>
            <span style={{ fontSize: 14 }}>
              <strong className="adm-mono" style={{ fontSize: 16 }}>{created.code}</strong>: {created.maxUses} {created.maxUses === 1 ? 'use' : 'uses'}, until {showDate(created.expiresAt)}{created.note ? ` · ${created.note}` : ''}
            </span>
            <button type="button" onClick={() => copy('created', created.code)} className="adm-btn adm-btn--green">
              {copied === 'created' ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copied === 'created' ? 'Copied' : 'Copy code'}
            </button>
            <button type="button" onClick={() => setCreated(null)} aria-label="Close" className="adm-icon-btn" style={{ marginLeft: 'auto' }}><X size={16} /></button>
          </div>
        )}
      </form>

      {/* The edit row's fields live in table cells; this form, outside the table, holds them together. */}
      <form id="promo-edit" onSubmit={saveEdit} />

      <div style={{ marginTop: 18 }}>
        {loading ? (
          <p className="adm-muted">Loading…</p>
        ) : !rows ? (
          <LoadError what="The promo codes" onRetry={() => setAttempt(n => n + 1)} detail={list.detail} />
        ) : rows.length === 0 ? (
          <div className="adm-card" style={{ textAlign: 'center', padding: 36 }}>
            <p className="adm-h2" style={{ marginBottom: 6 }}>No codes yet</p>
            <p className="adm-muted" style={{ margin: 0 }}>Make the first one above.</p>
          </div>
        ) : (
          <div className="adm-card adm-table-wrap" style={{ padding: '8px 12px' }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th className="adm-num">Used</th>
                  <th className="adm-num" title="Promo swings on this code that became a claim">Claimed</th>
                  <th className="adm-num" title="Golfers who used this code and have staked real money since">Staked after</th>
                  <th>Works until</th>
                  <th>Status</th>
                  <th>Note</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isEditing = editing?.id === r.id
                  const status = STATUS[r.status]
                  return (
                    <tr key={r.id} style={{ verticalAlign: 'middle' }}>
                      <td className="adm-mono" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {r.code}
                        <button type="button" onClick={() => copy(r.id, r.code)} aria-label={`Copy ${r.code}`} title="Copy" className="adm-icon-btn" style={{ width: 28, height: 28, marginLeft: 6, verticalAlign: 'middle' }}>
                          {copied === r.id ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </td>
                      <td className="adm-num">
                        {isEditing ? (
                          <>{r.uses} of <input form="promo-edit" type="number" required min={1} max={100000} value={editing.maxUses} onChange={e => setEditing({ ...editing, maxUses: e.target.value })} aria-label="Uses in total" className="adm-input" style={{ width: 90, padding: '6px 8px' }} /></>
                        ) : `${r.uses} of ${r.maxUses}`}
                      </td>
                      <td className="adm-num" style={{ fontWeight: r.claimed > 0 ? 700 : undefined, color: r.claimed > 0 ? 'var(--red)' : undefined }}>{r.claimed}</td>
                      <td className="adm-num">{r.converted}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {isEditing ? (
                          <input
                            form="promo-edit"
                            type="date"
                            required
                            // A new date must be today or later; an expired code's own date may stay while the rest changes.
                            min={editing.expires === sastDate(r.expiresAt) ? undefined : today}
                            value={editing.expires}
                            onChange={e => setEditing({ ...editing, expires: e.target.value })}
                            aria-label="Works until"
                            className="adm-input"
                            style={{ padding: '6px 8px' }}
                          />
                        ) : showDate(r.expiresAt)}
                      </td>
                      <td><span className={status.pill}>{status.label}</span></td>
                      <td className="adm-muted" style={{ minWidth: isEditing ? 200 : undefined }}>
                        {isEditing ? (
                          <input form="promo-edit" value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })} maxLength={200} aria-label="Note" placeholder="None" className="adm-input" style={{ width: '100%', padding: '6px 8px' }} />
                        ) : r.note ?? ''}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {isEditing ? (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <button type="submit" form="promo-edit" disabled={editBusy} className="adm-btn adm-btn--green">{editBusy ? 'Saving…' : 'Save'}</button>
                            <button type="button" onClick={() => setEditing(null)} disabled={editBusy} className="adm-btn adm-btn--quiet">Cancel</button>
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <button type="button" aria-label={`Change ${r.code}`} title="Change the limit, the date or the note" onClick={() => startEdit(r)} className="adm-icon-btn"><Pencil size={15} /></button>
                            <button
                              type="button"
                              aria-label={r.disabledAt ? `Switch ${r.code} on` : `Switch ${r.code} off`}
                              title={r.disabledAt ? 'Switch on' : 'Switch off'}
                              onClick={() => {
                                if (r.disabledAt) { void switchOn(r); return }
                                setConfirmError(null)
                                setConfirming({ action: 'off', row: r })
                              }}
                              className={`adm-icon-btn${r.disabledAt ? ' adm-icon-btn--ok' : ' adm-icon-btn--warn'}`}
                            >
                              <Power size={15} />
                            </button>
                            {r.uses === 0 && (
                              <button type="button" aria-label={`Delete ${r.code}`} title="Delete" onClick={() => { setConfirmError(null); setConfirming({ action: 'delete', row: r }) }} className="adm-icon-btn" style={{ color: 'var(--red)' }}>
                                <Trash2 size={15} />
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {editError && <p role="alert" className="adm-error" style={{ margin: '8px 10px' }}>{editError}</p>}
          </div>
        )}
      </div>

      <p className="adm-small" style={{ marginTop: 14, maxWidth: 720 }}>
        Every use is a real prize with no stake behind it, and a golfer with a second email address can use a code twice.
        Keep limits small and dates short, and give each campaign its own code so this table shows which one brings golfers back.
      </p>

      <ConfirmModal
        open={confirming !== null}
        title={confirming?.action === 'delete' ? `Delete ${confirming.row.code}?` : `Switch ${confirming?.row.code ?? ''} off?`}
        message={confirming?.action === 'delete'
          ? 'Nobody has played it yet, so nothing is lost. The code stops working at once.'
          : 'Golfers who have not played it yet can no longer use it. You can switch it on again.'}
        confirmLabel={confirming?.action === 'delete' ? 'Delete' : 'Switch off'}
        onConfirm={confirm}
        onCancel={() => setConfirming(null)}
        busy={confirmBusy}
        error={confirmError}
      />
    </div>
  )
}
