'use client'

import { useEffect, useState } from 'react'
import { Copy, Check, Pencil, Power, Trash2 } from 'lucide-react'
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

const STATUS: Record<PromoStatus, { label: string; bg: string; fg: string }> = {
  active:   { label: 'Active',   bg: '#e6f4ea', fg: '#1e6b30' },
  used_up:  { label: 'Used up',  bg: '#fff3e0', fg: '#a35200' },
  expired:  { label: 'Expired',  bg: '#f3f3f3', fg: '#666' },
  disabled: { label: 'Off',      bg: '#fdecea', fg: '#b00020' },
}

/**
 * Promo codes: each one is an extra free swing per golfer, up to its limit
 * and until its date. Golfers type it on the stake screen. Switching a
 * code off stops it at once; a code nobody has played can be deleted.
 */
export default function AdminPromosPage() {
  const [rows, setRows] = useState<AdminPromo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [code, setCode] = useState('')
  const [maxUses, setMaxUses] = useState('50')
  const [expires, setExpires] = useState(() => sastDate(new Date(Date.now() + 30 * DAY).toISOString()))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; maxUses: string; expires: string } | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/promos')
      .then(r => r.json())
      .then(json => { if (!cancelled) setRows(json.data ?? []) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [refresh])

  async function send(url: string, method: string, body?: unknown): Promise<boolean> {
    setError(null)
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(json.error ?? 'That did not work. Please try again.')
      return false
    }
    setRefresh(n => n + 1)
    return true
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const ok = await send('/api/admin/promos', 'POST', {
        code: code.trim() || undefined,
        maxUses: Number(maxUses),
        expiresAt: endOfSastDay(expires),
        note: note.trim() || undefined,
      })
      if (ok) { setCode(''); setNote('') }
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit() {
    if (!editing) return
    const ok = await send(`/api/admin/promos/${editing.id}`, 'PATCH', {
      maxUses: Number(editing.maxUses),
      expiresAt: endOfSastDay(editing.expires),
    })
    if (ok) setEditing(null)
  }

  async function toggle(row: AdminPromo) {
    const off = !row.disabledAt
    if (off && !confirm(`Switch off ${row.code}? Golfers who have not played it yet can no longer use it.`)) return
    await send(`/api/admin/promos/${row.id}`, 'PATCH', { disabled: off })
  }

  async function remove(row: AdminPromo) {
    if (!confirm(`Delete ${row.code}? Nobody has played it yet.`)) return
    await send(`/api/admin/promos/${row.id}`, 'DELETE')
  }

  async function copy(row: AdminPromo) {
    try {
      await navigator.clipboard.writeText(row.code)
      setCopied(row.id)
      setTimeout(() => setCopied(null), 1500)
    } catch { /* clipboard blocked; the code is visible anyway */ }
  }

  const input: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, color: '#333', background: '#fff' }
  const th: React.CSSProperties = { padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '12px 14px', color: '#333', verticalAlign: 'middle' }
  const iconButton: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', color: '#666', padding: 4 }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>Promo codes</h1>
        <p style={{ fontSize: 14, color: '#666', maxWidth: 720 }}>
          Each code is one extra free swing per golfer, up to its limit and until the end of its expiry date (South African time).
          Golfers type it under &ldquo;Have a promo code?&rdquo; on the stake screen.
        </p>
      </div>

      <form onSubmit={create} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#666' }}>
          Code
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Leave blank to generate" maxLength={40} style={{ ...input, minWidth: 200, fontFamily: 'monospace' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#666' }}>
          Uses in total
          <input type="number" min={1} max={100000} required value={maxUses} onChange={e => setMaxUses(e.target.value)} style={{ ...input, width: 110 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#666' }}>
          Works until
          <input type="date" required value={expires} min={sastDate(new Date().toISOString())} onChange={e => setExpires(e.target.value)} style={input} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#666' }}>
          Note
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Where it is going, e.g. Zimbali club day" maxLength={200} style={{ ...input, minWidth: 260 }} />
        </label>
        <button type="submit" disabled={busy} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: '#345231', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {busy ? 'Creating…' : 'Create code'}
        </button>
      </form>
      {error && <p role="alert" style={{ color: '#b00020', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
              <th style={th}>Code</th>
              <th style={{ ...th, textAlign: 'right' }}>Used</th>
              <th style={{ ...th, textAlign: 'right' }} title="Promo swings on this code that became a claim">Claimed</th>
              <th style={{ ...th, textAlign: 'right' }} title="Golfers who used this code and have staked real money since">Staked after</th>
              <th style={th}>Works until</th>
              <th style={th}>Status</th>
              <th style={th}>Note</th>
              <th style={{ ...th, textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr><td colSpan={8} style={{ padding: 20, color: '#999' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 20, color: '#999' }}>No codes yet.</td></tr>
            ) : rows.map(r => {
              const isEditing = editing?.id === r.id
              const status = STATUS[r.status]
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ ...td, fontFamily: 'monospace', color: '#111', whiteSpace: 'nowrap' }}>
                    {r.code}
                    <button type="button" onClick={() => copy(r)} title="Copy" style={{ ...iconButton, marginLeft: 6, verticalAlign: 'middle' }}>
                      {copied === r.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {isEditing ? (
                      <>{r.uses} of <input type="number" min={1} max={100000} value={editing.maxUses} onChange={e => setEditing({ ...editing, maxUses: e.target.value })} style={{ ...input, width: 80, padding: '4px 8px' }} /></>
                    ) : `${r.uses} of ${r.maxUses}`}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: r.claimed > 0 ? '#c0392b' : '#333' }}>{r.claimed}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.converted}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {isEditing ? (
                      <input type="date" value={editing.expires} onChange={e => setEditing({ ...editing, expires: e.target.value })} style={{ ...input, padding: '4px 8px' }} />
                    ) : showDate(r.expiresAt)}
                  </td>
                  <td style={td}>
                    <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: status.bg, color: status.fg, whiteSpace: 'nowrap' }}>{status.label}</span>
                  </td>
                  <td style={{ ...td, color: '#666' }}>{r.note ?? ''}</td>
                  <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {isEditing ? (
                      <>
                        <button type="button" onClick={saveEdit} style={{ ...iconButton, color: '#345231', fontWeight: 600 }}>Save</button>
                        <button type="button" onClick={() => setEditing(null)} style={iconButton}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" title="Change the limit or the date" onClick={() => setEditing({ id: r.id, maxUses: String(r.maxUses), expires: sastDate(r.expiresAt) })} style={iconButton}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" title={r.disabledAt ? 'Switch on' : 'Switch off'} onClick={() => toggle(r)} style={{ ...iconButton, color: r.disabledAt ? '#1e6b30' : '#a35200' }}>
                          <Power size={15} />
                        </button>
                        {r.uses === 0 && (
                          <button type="button" title="Delete" onClick={() => remove(r)} style={{ ...iconButton, color: '#b00020' }}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: '#888', marginTop: 12, maxWidth: 720 }}>
        Every use is a real prize with no stake behind it, and a golfer with a second email address can use a code twice.
        Keep limits small and dates short, and give each campaign its own code so this table shows which one brings golfers back.
      </p>
    </div>
  )
}
