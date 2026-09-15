'use client'

import { useEffect, useState } from 'react'
import { KeyRound, Mail, Trash2, Copy, Check } from 'lucide-react'
import type { BetaAccessKind } from '@/types/database'

interface Row { id: number; kind: BetaAccessKind; value: string; note: string | null; added_by: string | null; created_at: string }

/**
 * Who may use the app while BETA_GATE=on. Add an email (they sign in with
 * it) or generate an invite code (they type it at /beta). Removing a row
 * locks that tester out on their next page view.
 */
export default function AdminBetaPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [gate, setGate] = useState<boolean | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [kind, setKind] = useState<BetaAccessKind>('email')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/beta')
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        setRows(json.data ?? [])
        setGate(json.gate ?? null)
      })
      .catch(() => { if (!cancelled) setRows([]) })
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
      if (!res.ok) { setError(json.error ?? 'Could not add.'); return }
      setValue('')
      setNote('')
      setRefresh(n => n + 1)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    if (!confirm('Remove this tester? They lose access on their next page view.')) return
    const res = await fetch(`/api/admin/beta?id=${id}`, { method: 'DELETE' })
    if (res.ok) setRefresh(n => n + 1)
  }

  async function copy(row: Row) {
    try {
      await navigator.clipboard.writeText(row.value.toUpperCase())
      setCopied(row.id)
      setTimeout(() => setCopied(null), 1500)
    } catch { /* clipboard blocked; the value is visible anyway */ }
  }

  const input: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, color: '#333', background: '#fff' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>Beta testers</h1>
          <p style={{ fontSize: 14, color: '#666' }}>Who may use the app while the closed beta is on. Changes apply on the tester&rsquo;s next page view.</p>
        </div>
        {gate !== null && (
          <span style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: gate ? '#e6f4ea' : '#f3f3f3', color: gate ? '#1e6b30' : '#666' }}>
            Gate {gate ? 'ON' : 'OFF'} (BETA_GATE env)
          </span>
        )}
      </div>

      <form onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={kind} onChange={e => setKind(e.target.value as BetaAccessKind)} style={input}>
          <option value="email">Email address</option>
          <option value="code">Invite code</option>
        </select>
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={kind === 'email' ? 'golfer@example.com' : 'Leave blank to generate'}
          type={kind === 'email' ? 'email' : 'text'}
          required={kind === 'email'}
          style={{ ...input, minWidth: 260 }}
        />
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (who, which club)" style={{ ...input, minWidth: 220 }} />
        <button type="submit" disabled={busy} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#345231', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {busy ? 'Adding…' : kind === 'email' ? 'Add email' : 'Create code'}
        </button>
        {error && <span style={{ color: '#b00020', fontSize: 13 }}>{error}</span>}
      </form>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Kind</th>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Value</th>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Note</th>
              <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Added</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr><td colSpan={5} style={{ padding: 20, color: '#999' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 20, color: '#999' }}>Nobody on the list yet. With the gate on, only admins could get in.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '12px 14px', color: '#333' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {r.kind === 'email' ? <Mail size={14} /> : <KeyRound size={14} />} {r.kind}
                  </span>
                </td>
                <td style={{ padding: '12px 14px', fontFamily: r.kind === 'code' ? 'monospace' : undefined, color: '#111' }}>
                  {r.kind === 'code' ? r.value.toUpperCase() : r.value}
                  {r.kind === 'code' && (
                    <button type="button" onClick={() => copy(r)} title="Copy" style={{ marginLeft: 8, border: 'none', background: 'none', cursor: 'pointer', color: '#666', verticalAlign: 'middle' }}>
                      {copied === r.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  )}
                </td>
                <td style={{ padding: '12px 14px', color: '#666' }}>{r.note ?? ''}</td>
                <td style={{ padding: '12px 14px', textAlign: 'right', color: '#666' }}>{new Date(r.created_at).toLocaleDateString('en-ZA')}</td>
                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                  <button type="button" onClick={() => remove(r.id)} title="Remove" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b00020' }}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: '#888', marginTop: 12 }}>
        Turn the gate on by setting <code>BETA_GATE=on</code> in Vercel (Production or Preview) and redeploying. Admin accounts are not exempt: add your own email first.
      </p>
    </div>
  )
}
