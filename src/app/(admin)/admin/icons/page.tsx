'use client'

import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Pencil, Trash2, X } from 'lucide-react'
import ConfirmModal from '@/components/admin/ConfirmModal'
import LoadError from '@/components/admin/LoadError'

interface Row { id: string; name: string; team: 'rsa' | 'world'; is_captain: boolean; tagline: string | null; photo_url: string | null; sort_order: number; is_active: boolean; created_at: string; votes: number }

const OFFLINE = 'Could not reach the server. Check your connection and try again.'

/**
 * The field for Back an Icon. Add a name, a one-line tagline and an optional
 * photo URL; order controls the list; hidden Icons stay in the table with
 * their picks but disappear from the app. Deleting removes the picks too.
 */
export default function AdminIconsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [team, setTeam] = useState<'rsa' | 'world'>('rsa')
  const [isCaptain, setIsCaptain] = useState(false)
  const [tagline, setTagline] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [sortOrder, setSortOrder] = useState('')
  const [busy, setBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  // A change made in the table that was refused, said above the table.
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string; tagline: string; photoUrl: string } | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/icons')
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) { setLoadError(json.error ?? `The server answered ${res.status}.`); return }
        setLoadError(null)
        setRows(json.data ?? [])
        setTotal(json.totalVotes ?? 0)
      })
      .catch(() => { if (!cancelled) setLoadError(OFFLINE) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [refresh])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setAddError(null)
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
      if (!res.ok) { setAddError(json.error ?? 'Could not add. Please try again.'); return }
      setName(''); setTagline(''); setPhotoUrl(''); setSortOrder(''); setIsCaptain(false)
      setRefresh(n => n + 1)
    } catch {
      setAddError(OFFLINE)
    } finally {
      setBusy(false)
    }
  }

  /** Change one Icon; true when it saved. A refusal is said above the table. */
  async function patch(row: Row, body: Record<string, unknown>): Promise<boolean> {
    setBusyId(row.id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/icons/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(`${row.name}: ${json.error ?? 'the change was not saved. Please try again.'}`); return false }
      setRefresh(n => n + 1)
      return true
    } catch {
      setError(`${row.name}: ${OFFLINE}`)
      return false
    } finally {
      setBusyId(null)
    }
  }

  /** The Order box saves on leaving it. Emptied means no change, not 0. */
  async function saveOrder(row: Row, input: HTMLInputElement) {
    const raw = input.value.trim()
    const reset = () => { input.value = String(row.sort_order) }
    if (raw === '') { reset(); return }
    const v = Number(raw)
    if (!Number.isInteger(v) || v < 0 || v > 10000) {
      setError(`${row.name}: the order is a whole number from 0 to 10 000.`)
      reset()
      return
    }
    if (v === row.sort_order) return
    if (!(await patch(row, { sortOrder: v }))) reset()
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    const row = editing && rows.find(r => r.id === editing.id)
    if (!editing || !row) return
    const saved = await patch(row, {
      name: editing.name.trim(),
      tagline: editing.tagline.trim() || null,
      photoUrl: editing.photoUrl.trim() || null,
    })
    if (saved) setEditing(null)
  }

  async function remove() {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/admin/icons/${deleting.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setDeleteError(json.error ?? 'Could not delete. Please try again.'); return }
      setDeleting(null)
      setRefresh(n => n + 1)
    } catch {
      setDeleteError(OFFLINE)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div>
      <title>Icons · Get Lucky admin</title>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">Icons</h1>
          <p className="adm-lead">The field golfers can back on the Icons tab. Changes show in the app straight away.</p>
        </div>
        <span className="adm-pill">{total.toLocaleString('en-ZA')} pick{total === 1 ? '' : 's'}</span>
      </div>

      <form onSubmit={add} className="adm-card adm-card--form adm-row" style={{ marginBottom: 16 }}>
        <label className="adm-field" style={{ flex: '1 1 200px' }}>
          Name
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Ernie Els" required maxLength={80} className="adm-input" />
        </label>
        <label className="adm-field">
          Team
          <select value={team} onChange={e => setTeam(e.target.value as 'rsa' | 'world')} className="adm-input">
            <option value="rsa">Team South Africa</option>
            <option value="world">Team World</option>
          </select>
        </label>
        <label className="adm-field" style={{ flex: '1 1 220px' }}>
          Tagline
          <input value={tagline} onChange={e => setTagline(e.target.value)} placeholder="The Big Easy" maxLength={120} className="adm-input" />
        </label>
        <label className="adm-field" style={{ flex: '1 1 240px' }}>
          Photo URL <span className="adm-hint">optional; blank shows initials</span>
          <input value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} placeholder="https://" type="url" maxLength={500} className="adm-input" />
        </label>
        <label className="adm-field">
          Order
          <input value={sortOrder} onChange={e => setSortOrder(e.target.value)} placeholder="100" type="number" min={0} max={10000} step={1} className="adm-input" style={{ width: 96 }} />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, minHeight: 44 }}>
          <input type="checkbox" checked={isCaptain} onChange={e => setIsCaptain(e.target.checked)} /> Captain
        </label>
        <button type="submit" disabled={busy} className="adm-btn">
          {busy ? 'Adding…' : 'Add Icon'}
        </button>
        {addError && <p role="alert" className="adm-error" style={{ margin: 0, flexBasis: '100%' }}>{addError}</p>}
      </form>

      {error && <p role="alert" className="adm-error" style={{ margin: '0 0 12px' }}>{error}</p>}

      {loadError ? (
        <LoadError what="The Icons" onRetry={() => { setLoadError(null); setLoaded(false); setRefresh(n => n + 1) }} detail={loadError} />
      ) : (
        <form onSubmit={saveEdit} className="adm-card">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Team</th>
                  <th>Order</th>
                  <th>Tagline</th>
                  <th>Photo</th>
                  <th style={{ textAlign: 'right' }}>Picks</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!loaded ? (
                  <tr><td colSpan={7} className="adm-muted">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="adm-muted" style={{ padding: 28, textAlign: 'center' }}>No Icons yet. The app shows &ldquo;The field hasn&rsquo;t been announced yet&rdquo; until you add one.</td></tr>
                ) : rows.map(r => {
                  const edit = editing?.id === r.id ? editing : null
                  const rowBusy = busyId === r.id
                  return (
                    <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
                      <td>
                        {edit ? (
                          <input value={edit.name} onChange={e => setEditing({ ...edit, name: e.target.value })} required maxLength={80} aria-label="Name" className="adm-input" style={{ width: 170 }} />
                        ) : (
                          <span style={{ fontWeight: 700 }}>{r.name}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => patch(r, { isCaptain: !r.is_captain })}
                          disabled={rowBusy}
                          aria-pressed={r.is_captain}
                          aria-label={r.is_captain ? `${r.name} is captain. Unmark` : `Make ${r.name} captain`}
                          className={r.is_captain ? 'adm-pill adm-pill--green' : 'adm-pill'}
                          style={{ marginLeft: 8, border: 'none', cursor: 'pointer' }}
                        >
                          {r.is_captain ? 'Captain' : 'Captain?'}
                        </button>
                        {!r.is_active && <div className="adm-small">Hidden from the app</div>}
                      </td>
                      <td>
                        <select value={r.team} onChange={e => patch(r, { team: e.target.value })} disabled={rowBusy} aria-label={`Team for ${r.name}`} className="adm-input" style={{ padding: '6px 10px' }}>
                          <option value="rsa">South Africa</option>
                          <option value="world">World</option>
                        </select>
                      </td>
                      <td>
                        <input
                          key={`${r.id}:${r.sort_order}`}
                          type="number"
                          defaultValue={r.sort_order}
                          min={0}
                          max={10000}
                          step={1}
                          disabled={rowBusy}
                          aria-label={`Order for ${r.name}`}
                          onBlur={e => saveOrder(r, e.currentTarget)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
                          className="adm-input"
                          style={{ width: 84, padding: '6px 10px' }}
                        />
                      </td>
                      <td className={edit ? undefined : 'adm-muted'}>
                        {edit
                          ? <input value={edit.tagline} onChange={e => setEditing({ ...edit, tagline: e.target.value })} maxLength={120} aria-label="Tagline" placeholder="None" className="adm-input" style={{ width: 190 }} />
                          : r.tagline ?? ''}
                      </td>
                      <td>
                        {edit ? (
                          <input value={edit.photoUrl} onChange={e => setEditing({ ...edit, photoUrl: e.target.value })} type="url" maxLength={500} aria-label="Photo URL" placeholder="Blank for initials" className="adm-input" style={{ width: 200 }} />
                        ) : r.photo_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={r.photo_url} alt="" width={36} height={36} style={{ borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
                          : <span className="adm-muted">Initials</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.votes.toLocaleString('en-ZA')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {edit ? (
                            <>
                              <button type="submit" disabled={rowBusy} className="adm-icon-btn adm-icon-btn--ok" aria-label={`Save ${r.name}`} title="Save"><Check size={16} /></button>
                              <button type="button" onClick={() => setEditing(null)} className="adm-icon-btn" aria-label="Cancel" title="Cancel"><X size={16} /></button>
                            </>
                          ) : (
                            <>
                              <button type="button" onClick={() => setEditing({ id: r.id, name: r.name, tagline: r.tagline ?? '', photoUrl: r.photo_url ?? '' })} className="adm-icon-btn" aria-label={`Edit ${r.name}`} title="Edit name, tagline and photo"><Pencil size={15} /></button>
                              <button type="button" onClick={() => patch(r, { isActive: !r.is_active })} disabled={rowBusy} className="adm-icon-btn" aria-label={r.is_active ? `Hide ${r.name} from the app` : `Show ${r.name} in the app`} title={r.is_active ? 'Hide from the app' : 'Show in the app'}>
                                {r.is_active ? <Eye size={16} /> : <EyeOff size={16} />}
                              </button>
                              <button type="button" onClick={() => { setDeleteError(null); setDeleting(r) }} className="adm-icon-btn adm-icon-btn--warn" aria-label={`Delete ${r.name}`} title="Delete"><Trash2 size={15} /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}

      <p className="adm-small" style={{ marginTop: 12 }}>
        Event name, venue, dates, the prize card and the sponsor line come from <code>src/lib/icons.ts</code>. Player photos need rights; leave the URL blank for initials.
      </p>

      <ConfirmModal
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ''}?`}
        message={deleting
          ? `${deleting.votes.toLocaleString('en-ZA')} pick${deleting.votes === 1 ? '' : 's'} will be deleted with it. Hiding it (the eye) keeps them.`
          : ''}
        confirmLabel="Delete Icon"
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
        busy={deleteBusy}
        error={deleteError}
      />
    </div>
  )
}
