'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Copy, Check, Pencil, Power, Users, Plus } from 'lucide-react'
import type { AdminGolfDay, GolfDayPhase } from '@/lib/golf-days/rules'
import { golfDayPath, todayInSouthAfrica } from '@/lib/golf-days/rules'

interface CourseOption {
  id: string
  name: string
  is_partner: boolean
  holes: { id: string; hole_number: number; par: number; distance_metres: number | null; playable: boolean }[]
}

interface Player {
  userId: string
  name: string | null
  email: string | null
  joinedAt: string
  swing: { betId: string; status: string; at: string; hole: string | null } | null
}

interface Form {
  slug: string
  name: string
  tabLabel: string
  playsOn: string
  prizeRand: string
  maxPlayers: string
  holeIds: string[]
  note: string
}

const EMPTY: Form = { slug: '', name: '', tabLabel: '', playsOn: '', prizeRand: '100000', maxPlayers: '200', holeIds: [], note: '' }

const PHASE: Record<GolfDayPhase, { label: string; bg: string; fg: string }> = {
  upcoming: { label: 'Coming up', bg: '#e8f0fe', fg: '#1a4fb0' },
  today:    { label: 'Today',     bg: '#e6f4ea', fg: '#1e6b30' },
  over:     { label: 'Over',      bg: '#f3f3f3', fg: '#666' },
}

const SWING: Record<string, string> = { active: 'Started', miss: 'Missed', claimed: 'Claimed', verified: 'Verified', paid: 'Paid' }

function showDate(playsOn: string): string {
  return new Date(`${playsOn}T12:00:00+02:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })
}

/**
 * Golf days we sponsor. Each has its own link; players who join through it
 * get the golf day's tab in place of Icons and one free swing on the day,
 * on its holes, for its prize. Nobody else sees any of it.
 */
export default function AdminGolfDaysPage() {
  const [rows, setRows] = useState<AdminGolfDay[]>([])
  const [loaded, setLoaded] = useState(false)
  const [courses, setCourses] = useState<CourseOption[]>([])
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null)
  const [pickCourse, setPickCourse] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // list: null while loading; failed: the list could not be read (never shown as "nobody").
  const [players, setPlayers] = useState<{ id: string; list: Player[] | null; failed?: boolean } | null>(null)
  const [refresh, setRefresh] = useState(0)
  // This site's address, for the full link to send out; empty while server-rendered.
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => '')

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/golf-days')
      .then(r => r.json())
      .then(json => { if (!cancelled) setRows(json.data ?? []) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [refresh])

  // Partner courses and their holes, for the hole picker.
  useEffect(() => {
    let cancelled = false
    fetch('/api/courses')
      .then(r => r.json())
      .then(json => { if (!cancelled) setCourses(((json.courses ?? []) as CourseOption[]).filter(c => c.is_partner)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const holeLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of courses) for (const h of c.holes) map.set(h.id, `${c.name}, hole ${h.hole_number} (${h.distance_metres ?? '?'} m)`)
    for (const r of rows) for (const h of r.holes) map.set(h.holeId, `${h.course.name}, hole ${h.holeNumber} (${h.distanceMetres ?? '?'} m)`)
    return map
  }, [courses, rows])

  function startCreate() {
    setError(null)
    setEditing({ id: null, form: { ...EMPTY, playsOn: todayInSouthAfrica() } })
  }

  function startEdit(r: AdminGolfDay) {
    setError(null)
    setEditing({
      id: r.id,
      form: {
        slug: r.slug, name: r.name, tabLabel: r.tabLabel, playsOn: r.playsOn,
        prizeRand: String(r.prizeZAR), maxPlayers: String(r.maxPlayers), holeIds: r.holes.map(h => h.holeId), note: r.note ?? '',
      },
    })
  }

  function setField<K extends keyof Form>(key: K, value: Form[K]) {
    setEditing(e => (e ? { ...e, form: { ...e.form, [key]: value } } : e))
  }

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

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    const f = editing.form
    const fields = {
      name: f.name.trim(), tabLabel: f.tabLabel.trim(), playsOn: f.playsOn,
      prizeRand: Number(f.prizeRand), maxPlayers: Number(f.maxPlayers), holeIds: f.holeIds, note: f.note.trim() || null,
    }
    setBusy(true)
    try {
      const ok = editing.id
        ? await send(`/api/admin/golf-days/${editing.id}`, 'PATCH', fields)
        : await send('/api/admin/golf-days', 'POST', { slug: f.slug.trim().toLowerCase(), ...fields })
      if (ok) setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  async function toggle(r: AdminGolfDay) {
    const off = !r.disabledAt
    if (off && !confirm(`Switch off ${r.name}? Its tab disappears and nobody can take a swing until you switch it on again.`)) return
    await send(`/api/admin/golf-days/${r.id}`, 'PATCH', { disabled: off })
  }

  async function showPlayers(r: AdminGolfDay) {
    if (players?.id === r.id) { setPlayers(null); return }
    setPlayers({ id: r.id, list: null })
    try {
      const res = await fetch(`/api/admin/golf-days/${r.id}/players`)
      const json = await res.json().catch(() => ({}))
      setPlayers(res.ok ? { id: r.id, list: json.data ?? [] } : { id: r.id, list: [], failed: true })
    } catch {
      setPlayers({ id: r.id, list: [], failed: true })
    }
  }

  async function copy(r: AdminGolfDay) {
    try {
      await navigator.clipboard.writeText(`${origin}${golfDayPath(r.slug)}`)
      setCopied(r.id)
      setTimeout(() => setCopied(null), 1500)
    } catch { /* clipboard blocked; the link is visible anyway */ }
  }

  const input: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, color: '#333', background: '#fff' }
  const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#666' }
  const iconButton: React.CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', color: '#666', padding: 4 }
  const pickable = courses.find(c => c.id === pickCourse)?.holes.filter(h => h.playable) ?? []

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>Golf days</h1>
          <p style={{ fontSize: 14, color: '#666', maxWidth: 720 }}>
            Each golf day has its own link. Players who join through it see the golf day&rsquo;s tab in place of Icons and get one free swing,
            on the day (South African time), on its holes, for its prize. Nobody else sees any of it.
          </p>
        </div>
        {!editing && (
          <button type="button" onClick={startCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 8, border: 'none', background: '#345231', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <Plus size={15} /> New golf day
          </button>
        )}
      </div>

      {error && <p role="alert" style={{ color: '#b00020', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {editing && (
        <form onSubmit={save} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 18, marginBottom: 20, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={label}>
              Link
              {editing.id ? (
                <span style={{ ...input, background: '#f6f6f6', fontFamily: 'monospace' }}>{golfDayPath(editing.form.slug)}</span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'monospace', fontSize: 13, color: '#333' }}>
                  /golf-day/
                  <input required value={editing.form.slug} onChange={e => setField('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="bombsquad" maxLength={40} style={{ ...input, width: 160, fontFamily: 'monospace' }} />
                </span>
              )}
            </label>
            <label style={label}>
              Name
              <input required value={editing.form.name} onChange={e => setField('name', e.target.value)} placeholder="Bomb Squad Golf Day" maxLength={80} style={{ ...input, minWidth: 240 }} />
            </label>
            <label style={label}>
              Tab label (12 max)
              <input required value={editing.form.tabLabel} onChange={e => setField('tabLabel', e.target.value)} placeholder="Bomb Squad" maxLength={12} style={{ ...input, width: 130 }} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={label}>
              Played on
              <input type="date" required value={editing.form.playsOn} onChange={e => setField('playsOn', e.target.value)} style={input} />
            </label>
            <label style={label}>
              Prize (R)
              <input type="number" required min={1} max={1000000} value={editing.form.prizeRand} onChange={e => setField('prizeRand', e.target.value)} style={{ ...input, width: 130 }} />
            </label>
            <label style={label}>
              Players
              <input type="number" required min={1} max={5000} value={editing.form.maxPlayers} onChange={e => setField('maxPlayers', e.target.value)} style={{ ...input, width: 100 }} />
            </label>
            <label style={label}>
              Note
              <input value={editing.form.note} onChange={e => setField('note', e.target.value)} placeholder="Organiser, venue, anything to remember" maxLength={200} style={{ ...input, minWidth: 280 }} />
            </label>
          </div>
          <div style={label}>
            Holes (par 3s of 140 m or more; one per course the day is played on)
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {editing.form.holeIds.map(id => (
                <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: '#eef3ee', color: '#335231', fontSize: 12 }}>
                  {holeLabel.get(id) ?? id}
                  <button type="button" onClick={() => setField('holeIds', editing.form.holeIds.filter(h => h !== id))} style={{ ...iconButton, padding: 0, color: '#b00020' }} aria-label="Remove hole">×</button>
                </span>
              ))}
              {editing.form.holeIds.length === 0 && <span style={{ fontSize: 12, color: '#999' }}>None yet</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={pickCourse} onChange={e => setPickCourse(e.target.value)} style={{ ...input, minWidth: 280 }}>
                <option value="">Course…</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value="" onChange={e => { if (e.target.value && !editing.form.holeIds.includes(e.target.value)) setField('holeIds', [...editing.form.holeIds, e.target.value]) }} disabled={!pickCourse} style={input}>
                <option value="">Add a hole…</option>
                {pickable.map(h => <option key={h.id} value={h.id}>Hole {h.hole_number} · par {h.par} · {h.distance_metres} m</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" disabled={busy || editing.form.holeIds.length === 0} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: '#345231', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {busy ? 'Saving…' : editing.id ? 'Save changes' : 'Create golf day'}
            </button>
            <button type="button" onClick={() => setEditing(null)} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #e5e5e5', background: '#fff', color: '#333', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
          <p style={{ fontSize: 12, color: '#888', margin: 0 }}>
            The link cannot change once made, because it has been sent out. A new golf day uses the Get Lucky look; a host&rsquo;s own look
            (photo and colours) is added in code, in <code>src/lib/golf-days/themes.ts</code>.
          </p>
        </form>
      )}

      {!loaded ? (
        <p style={{ color: '#999', fontSize: 13 }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: '#999', fontSize: 13 }}>No golf days yet.</p>
      ) : rows.map(r => {
        const phase = r.disabledAt ? { label: 'Off', bg: '#fdecea', fg: '#b00020' } : PHASE[r.phase]
        return (
          <div key={r.id} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111', margin: 0 }}>{r.name}</h2>
                  <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: phase.bg, color: phase.fg }}>{phase.label}</span>
                </div>
                <p style={{ fontSize: 13, color: '#666', margin: '6px 0 0' }}>
                  {showDate(r.playsOn)} · R{r.prizeZAR.toLocaleString('en-ZA')} · tab &ldquo;{r.tabLabel}&rdquo;
                </p>
                <p style={{ fontSize: 13, color: '#666', margin: '4px 0 0' }}>{r.holes.map(h => `${h.course.name}, hole ${h.holeNumber}`).join(' · ') || 'No holes'}</p>
                <p style={{ fontSize: 13, margin: '8px 0 0', fontFamily: 'monospace', color: '#111' }}>
                  {origin}{golfDayPath(r.slug)}
                  <button type="button" onClick={() => copy(r)} title="Copy the link" style={{ ...iconButton, marginLeft: 6, verticalAlign: 'middle' }}>
                    {copied === r.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </p>
                {r.note && <p style={{ fontSize: 12, color: '#888', margin: '6px 0 0' }}>{r.note}</p>}
              </div>
              <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
                <Stat label="Joined" value={`${r.players} of ${r.maxPlayers}`} />
                <Stat label="Swings" value={String(r.swings)} />
                <Stat label="Claims" value={String(r.claimed)} alert={r.claimed > 0} />
                <div style={{ display: 'flex', gap: 2 }}>
                  <button type="button" title="Players" onClick={() => showPlayers(r)} style={iconButton}><Users size={16} /></button>
                  <button type="button" title="Edit" onClick={() => startEdit(r)} style={iconButton}><Pencil size={16} /></button>
                  <button type="button" title={r.disabledAt ? 'Switch on' : 'Switch off'} onClick={() => toggle(r)} style={{ ...iconButton, color: r.disabledAt ? '#1e6b30' : '#a35200' }}><Power size={16} /></button>
                </div>
              </div>
            </div>

            {players?.id === r.id && (
              <div style={{ marginTop: 14, borderTop: '1px solid #f0f0f0', paddingTop: 10, overflowX: 'auto' }}>
                {players.list === null ? (
                  <p style={{ color: '#999', fontSize: 13 }}>Loading players…</p>
                ) : players.failed ? (
                  <p style={{ color: '#b00020', fontSize: 13 }}>The players could not be loaded. Close and open the list to try again.</p>
                ) : players.list.length === 0 ? (
                  <p style={{ color: '#999', fontSize: 13 }}>Nobody has joined yet.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: '#666' }}>
                        <th style={{ padding: '6px 8px' }}>Player</th>
                        <th style={{ padding: '6px 8px' }}>Email</th>
                        <th style={{ padding: '6px 8px' }}>Joined</th>
                        <th style={{ padding: '6px 8px' }}>Swing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {players.list.map(p => (
                        <tr key={p.userId} style={{ borderTop: '1px solid #f5f5f5' }}>
                          <td style={{ padding: '6px 8px', color: '#111' }}>{p.name ?? '—'}</td>
                          <td style={{ padding: '6px 8px', color: '#666' }}>{p.email ?? '—'}</td>
                          <td style={{ padding: '6px 8px', color: '#666' }}>{new Date(p.joinedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                          <td style={{ padding: '6px 8px', color: p.swing?.status === 'claimed' ? '#c0392b' : '#333' }}>
                            {p.swing ? `${SWING[p.swing.status] ?? p.swing.status}${p.swing.hole ? ` · ${p.swing.hole}` : ''}` : 'Not taken'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )
      })}

      <p style={{ fontSize: 12, color: '#888', marginTop: 12, maxWidth: 720 }}>
        A golf day&rsquo;s prize is Get Lucky&rsquo;s own, not Indwe&rsquo;s. Its swings go through the same claim and review as any entry, and a claim shows up in the Verification Queue.
      </p>
    </div>
  )
}

function Stat({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: alert ? '#c0392b' : '#111' }}>{value}</div>
    </div>
  )
}
