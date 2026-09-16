'use client'

import { useEffect, useState } from 'react'
import { Trash2, Eye, EyeOff } from 'lucide-react'

interface Row { id: string; name: string; team: 'rsa' | 'world'; is_captain: boolean; tagline: string | null; photo_url: string | null; sort_order: number; is_active: boolean; created_at: string; votes: number }

/**
 * The field for Back an Icon. Add a name, a one-line tagline and an optional
 * photo URL; order controls the list; inactive Icons stay in the table with
 * their picks but disappear from the app. Deleting removes the picks too.
 */
export default function AdminIconsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [name, setName] = useState('')
  const [team, setTeam] = useState<'rsa' | 'world'>('rsa')
  const [isCaptain, setIsCaptain] = useState(false)
  const [tagline, setTagline] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [sortOrder, setSortOrder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/icons')
      .then(r => r.json())
      .then(json => { if (!cancelled) { setRows(json.data ?? []); setTotal(json.totalVotes ?? 0) } })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [refresh])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/icons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          team,
          isCaptain,
          tagline: tagline.trim() || undefined,
          photoUrl: photoUrl.trim() || undefined,
          sortOrder: sortOrder.trim() ? Number(sortOrder) : undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? 'Could not add.'); return }
      setName(''); setTagline(''); setPhotoUrl(''); setSortOrder(''); setIsCaptain(false)
      setRefresh(n => n + 1)
    } finally {
      setBusy(false)
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/icons/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) setRefresh(n => n + 1)
  }

  async function remove(row: Row) {
    if (!confirm(`Delete ${row.name}? ${row.votes} pick${row.votes === 1 ? '' : 's'} will be removed too. Deactivating keeps them.`)) return
    const res = await fetch(`/api/admin/icons/${row.id}`, { method: 'DELETE' })
    if (res.ok) setRefresh(n => n + 1)
  }

  const input: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, color: '#333', background: '#fff' }
  const th: React.CSSProperties = { padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }
  const td: React.CSSProperties = { padding: '12px 14px', color: '#333' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>Icons</h1>
          <p style={{ fontSize: 14, color: '#666' }}>The field golfers can back on the Icons tab. Changes show in the app immediately.</p>
        </div>
        <span style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: '#f3f3f3', color: '#666' }}>
          {total} pick{total === 1 ? '' : 's'}
        </span>
      </div>

      <form onSubmit={add} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" required maxLength={80} style={{ ...input, minWidth: 200 }} />
        <select value={team} onChange={e => setTeam(e.target.value as 'rsa' | 'world')} style={input}>
          <option value="rsa">Team South Africa</option>
          <option value="world">Team World</option>
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#333' }}>
          <input type="checkbox" checked={isCaptain} onChange={e => setIsCaptain(e.target.checked)} /> Captain
        </label>
        <input value={tagline} onChange={e => setTagline(e.target.value)} placeholder="Tagline (e.g. Springbok legend)" maxLength={120} style={{ ...input, minWidth: 240 }} />
        <input value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} placeholder="Photo URL (optional)" type="url" style={{ ...input, minWidth: 260 }} />
        <input value={sortOrder} onChange={e => setSortOrder(e.target.value)} placeholder="Order" type="number" min={0} style={{ ...input, width: 90 }} />
        <button type="submit" disabled={busy} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#345231', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {busy ? 'Adding…' : 'Add Icon'}
        </button>
        {error && <span style={{ color: '#b00020', fontSize: 13 }}>{error}</span>}
      </form>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
              <th style={th}>Team</th>
              <th style={th}>Order</th>
              <th style={th}>Name</th>
              <th style={th}>Tagline</th>
              <th style={th}>Photo</th>
              <th style={{ ...th, textAlign: 'right' }}>Picks</th>
              <th style={{ ...th, textAlign: 'center' }}>Shown</th>
              <th style={{ ...th, textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <tr><td colSpan={8} style={{ padding: 20, color: '#999' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 20, color: '#999' }}>No Icons yet. The app shows &ldquo;The field hasn&rsquo;t been announced yet&rdquo; until you add one.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f0f0f0', opacity: r.is_active ? 1 : 0.55 }}>
                <td style={td}>
                  <select value={r.team} onChange={e => patch(r.id, { team: e.target.value })} style={{ ...input, padding: '4px 8px' }}>
                    <option value="rsa">South Africa</option>
                    <option value="world">World</option>
                  </select>
                </td>
                <td style={td}>
                  <input
                    type="number"
                    defaultValue={r.sort_order}
                    min={0}
                    onBlur={e => { const v = Number(e.target.value); if (Number.isInteger(v) && v !== r.sort_order) patch(r.id, { sortOrder: v }) }}
                    style={{ ...input, width: 70, padding: '4px 8px' }}
                  />
                </td>
                <td style={{ ...td, color: '#111', fontWeight: 600 }}>
                  {r.name}
                  <button type="button" onClick={() => patch(r.id, { isCaptain: !r.is_captain })} title={r.is_captain ? 'Unmark captain' : 'Mark as captain'} style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 999, border: '1px solid #ddd', background: r.is_captain ? '#345231' : '#fff', color: r.is_captain ? '#fff' : '#666', fontSize: 11, cursor: 'pointer' }}>
                    {r.is_captain ? 'Captain' : 'captain?'}
                  </button>
                </td>
                <td style={{ ...td, color: '#666' }}>{r.tagline ?? ''}</td>
                <td style={td}>
                  {r.photo_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={r.photo_url} alt="" width={36} height={36} style={{ borderRadius: '50%', objectFit: 'cover' }} />
                    : <span style={{ color: '#999' }}>initials</span>}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{r.votes}</td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <button type="button" onClick={() => patch(r.id, { isActive: !r.is_active })} title={r.is_active ? 'Hide from the app' : 'Show in the app'} style={{ border: 'none', background: 'none', cursor: 'pointer', color: r.is_active ? '#1e6b30' : '#999' }}>
                    {r.is_active ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <button type="button" onClick={() => remove(r)} title="Delete" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b00020' }}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: '#888', marginTop: 12 }}>
        Event name, venue, dates, the prize card and the sponsor line come from <code>src/lib/icons.ts</code>. Player photos need rights; leave the URL blank for initials.
      </p>
    </div>
  )
}
