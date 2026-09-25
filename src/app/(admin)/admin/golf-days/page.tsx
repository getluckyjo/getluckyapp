'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Copy, Check, Pencil, Power, Users, Plus, MessageCircle, AlertTriangle, Trash2 } from 'lucide-react'
import ConfirmModal from '@/components/admin/ConfirmModal'
import LoadError from '@/components/admin/LoadError'
import type { AdminGolfDay, GolfDayHole, GolfDayPhase } from '@/lib/golf-days/rules'
import { golfDayPath, todayInSouthAfrica } from '@/lib/golf-days/rules'
import { golfDayMessage } from '@/lib/golf-days/message'
import { formatRand } from '@/lib/format'
import { themeFor } from '@/lib/golf-days/themes'
import LookEditor, { BLANK_LOOK, lookFormFrom, lookFrom, type LookForm } from './LookEditor'

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
  look: LookForm
}

const EMPTY: Form = { slug: '', name: '', tabLabel: '', playsOn: '', prizeRand: '100000', maxPlayers: '200', holeIds: [], note: '', look: BLANK_LOOK }

const PHASE: Record<GolfDayPhase, { label: string; pill: string }> = {
  upcoming: { label: 'Coming up', pill: 'adm-pill adm-pill--green' },
  today:    { label: 'Today',     pill: 'adm-pill adm-pill--lime' },
  over:     { label: 'Over',      pill: 'adm-pill' },
}

const SWING: Record<string, string> = { active: 'Started', miss: 'Missed', claimed: 'Claimed', verified: 'Verified', paid: 'Paid' }

/** Where the form is going when it has unsaved changes: closed, to a new golf day, or to another one. */
type Leave = { to: 'close' } | { to: 'create' } | { to: 'edit'; row: AdminGolfDay }

type Sent<T> = { ok: true; data: T } | { ok: false; error: string }

/** A change to a golf day, and what the server answered. Never throws: a dropped connection is an answer too. */
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

const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set([...a, ...b]).size === new Set(a).size

/** The list's order: the latest date first, as the server sends it. */
const byDate = (a: AdminGolfDay, b: AdminGolfDay) => b.playsOn.localeCompare(a.playsOn)

function showDate(playsOn: string): string {
  return new Date(`${playsOn}T12:00:00+02:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })
}

/**
 * Golf days we sponsor. Each has its own link; players who join through it
 * get the golf day's tab in place of Icons and one free swing on the day,
 * on its holes, for its prize. Nobody else sees any of it.
 */
export default function AdminGolfDaysPage() {
  const [attempt, setAttempt] = useState(0)
  // rows null: the list could not be loaded (never shown as "no golf days", which invites a duplicate).
  const [list, setList] = useState<{ attempt: number; rows: AdminGolfDay[] | null; detail: string | null } | null>(null)
  const [courseAttempt, setCourseAttempt] = useState(0)
  const [courseList, setCourseList] = useState<{ attempt: number; courses: CourseOption[] | null } | null>(null)
  // form is what the admin has typed; saved is the golf day as the form opened, to tell what changed.
  const [editing, setEditing] = useState<{ id: string | null; form: Form; saved: Form } | null>(null)
  // Bumped each time the form opens, to bring it into view.
  const [opens, setOpens] = useState(0)
  const [leaving, setLeaving] = useState<Leave | null>(null)
  const [pickCourse, setPickCourse] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ action: 'off' | 'delete'; row: AdminGolfDay } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // The golf day whose WhatsApp message is open, and the message as edited before copying.
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null)
  // list: null while loading; failed: the list could not be read (never shown as "nobody").
  const [players, setPlayers] = useState<{ id: string; list: Player[] | null; failed?: boolean } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // This site's address, for the full link to send out; empty while server-rendered.
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => '')

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/golf-days', { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (cancelled) return
        setList(res.ok && Array.isArray(json?.data) ? { attempt, rows: json.data, detail: null } : { attempt, rows: null, detail: json?.error ?? null })
      })
      .catch(() => { if (!cancelled) setList({ attempt, rows: null, detail: null }) })
    return () => { cancelled = true }
  }, [attempt])

  // Partner courses and their holes, for the hole picker. Not from the browser's
  // cache: /api/courses may be kept for minutes, and a course just made a
  // partner has to be here now.
  useEffect(() => {
    let cancelled = false
    fetch('/api/courses', { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (cancelled) return
        setCourseList(res.ok && Array.isArray(json?.courses)
          ? { attempt: courseAttempt, courses: (json.courses as CourseOption[]).filter(c => c.is_partner) }
          : { attempt: courseAttempt, courses: null })
      })
      .catch(() => { if (!cancelled) setCourseList({ attempt: courseAttempt, courses: null }) })
    return () => { cancelled = true }
  }, [courseAttempt])

  // The form opens at the top of the page: bring it into view, and the keyboard with it.
  useEffect(() => {
    if (!opens) return
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    formRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
    headingRef.current?.focus({ preventScroll: true })
  }, [opens])

  const loading = list?.attempt !== attempt
  const rows = loading ? null : list.rows
  const courses = useMemo(() => courseList?.courses ?? [], [courseList])
  const coursesLoading = courseList?.attempt !== courseAttempt
  const coursesFailed = !coursesLoading && courseList.courses === null

  const holeLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of courses) for (const h of c.holes) map.set(h.id, `${c.name}, hole ${h.hole_number} (${h.distance_metres ?? '?'} m)`)
    for (const r of rows ?? []) for (const h of r.holes) map.set(h.holeId, `${h.course.name}, hole ${h.holeNumber} (${h.distanceMetres ?? '?'} m)`)
    return map
  }, [courses, rows])

  // Every hole the picker or a golf day knows, in the shape the preview's label reads.
  const holeById = useMemo(() => {
    const map = new Map<string, GolfDayHole>()
    for (const c of courses) for (const h of c.holes) {
      map.set(h.id, { holeId: h.id, holeNumber: h.hole_number, par: h.par, distanceMetres: h.distance_metres, course: { id: c.id, name: c.name, location: '', region: '' } })
    }
    for (const r of rows ?? []) for (const h of r.holes) map.set(h.holeId, h)
    return map
  }, [courses, rows])

  const dirty = editing !== null && JSON.stringify(editing.form) !== JSON.stringify(editing.saved)
  const newPicture = editing !== null && editing.form.look.hero?.src !== editing.saved.look.hero?.src && Boolean(editing.form.look.hero)

  function open(id: string | null, form: Form) {
    setFormError(null)
    setEditing({ id, form, saved: form })
    setOpens(n => n + 1)
  }

  /** Close the form, or open it for another golf day, asking first when that would throw changes away. */
  function leave(next: Leave) {
    if (next.to === 'edit' && editing?.id === next.row.id) { setOpens(n => n + 1); return }
    if (dirty) { setLeaving(next); return }
    go(next)
  }

  function go(next: Leave) {
    setLeaving(null)
    if (next.to === 'close') { setEditing(null); setFormError(null); return }
    if (next.to === 'create') { open(null, { ...EMPTY, playsOn: todayInSouthAfrica() }); return }
    const r = next.row
    open(r.id, {
      slug: r.slug, name: r.name, tabLabel: r.tabLabel, playsOn: r.playsOn,
      prizeRand: String(r.prizeZAR), maxPlayers: String(r.maxPlayers), holeIds: r.holes.map(h => h.holeId), note: r.note ?? '',
      look: lookFormFrom(themeFor(r.slug, r.look)),
    })
  }

  function setField<K extends keyof Form>(key: K, value: Form[K]) {
    setEditing(e => (e ? { ...e, form: { ...e.form, [key]: value } } : e))
  }

  /** Put the server's copy of a golf day into the list, in date order. */
  function put(row: AdminGolfDay) {
    setList(l => (l?.rows ? { ...l, rows: [...l.rows.filter(r => r.id !== row.id), row].sort(byDate) } : l))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    const f = editing.form
    const fields: Record<string, unknown> = {
      name: f.name.trim(), tabLabel: f.tabLabel.trim(), playsOn: f.playsOn,
      prizeRand: Number(f.prizeRand), maxPlayers: Number(f.maxPlayers), note: f.note.trim() || null,
      look: lookFrom(f.look, f.name.trim()),
    }
    // The holes only when they changed: the server then leaves them alone, and
    // does not re-check a hole the day already has.
    if (!editing.id || !sameSet(f.holeIds, editing.saved.holeIds)) fields.holeIds = f.holeIds
    setFormError(null)
    setBusy(true)
    const sent = editing.id
      ? await send<AdminGolfDay>(`/api/admin/golf-days/${editing.id}`, 'PATCH', fields)
      : await send<AdminGolfDay>('/api/admin/golf-days', 'POST', { slug: f.slug.trim().toLowerCase(), ...fields })
    setBusy(false)
    if (!sent.ok) { setFormError(sent.error); return }
    put(sent.data)
    setEditing(null)
  }

  async function switchOn(r: AdminGolfDay) {
    setError(null)
    const sent = await send<AdminGolfDay>(`/api/admin/golf-days/${r.id}`, 'PATCH', { disabled: false })
    if (sent.ok) put(sent.data)
    else setError(`${r.name} was not switched on. ${sent.error}`)
  }

  async function confirm() {
    if (!confirming) return
    const { action, row } = confirming
    setConfirmError(null)
    setConfirmBusy(true)
    const sent = action === 'off'
      ? await send<AdminGolfDay>(`/api/admin/golf-days/${row.id}`, 'PATCH', { disabled: true })
      : await send<unknown>(`/api/admin/golf-days/${row.id}`, 'DELETE')
    setConfirmBusy(false)
    if (!sent.ok) { setConfirmError(sent.error); return }
    if (action === 'off') put(sent.data as AdminGolfDay)
    else {
      setList(l => (l?.rows ? { ...l, rows: l.rows.filter(r => r.id !== row.id) } : l))
      if (editing?.id === row.id) setEditing(null)
    }
    setConfirming(null)
  }

  function ask(action: 'off' | 'delete', row: AdminGolfDay) {
    setConfirmError(null)
    setConfirming({ action, row })
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

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    } catch { /* clipboard blocked; the text is on screen to copy by hand */ }
  }

  function toggleMessage(r: AdminGolfDay) {
    if (message?.id === r.id) { setMessage(null); return }
    setMessage({ id: r.id, text: golfDayMessage(r, { site: origin, venue: themeFor(r.slug, r.look).venue }) })
  }

  const pickable = courses.find(c => c.id === pickCourse)?.holes.filter(h => h.playable) ?? []

  return (
    <div>
      <title>Golf days · Get Lucky admin</title>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">Golf days</h1>
          <p className="adm-lead">
            Each golf day has its own link. Players who join through it see the golf day&rsquo;s tab in place of Icons and get one free swing,
            on the day (South African time), on its holes, for its prize. Nobody else sees any of it.
          </p>
        </div>
        {!editing && (
          <button type="button" onClick={() => leave({ to: 'create' })} className="adm-btn">
            <Plus size={18} aria-hidden /> New golf day
          </button>
        )}
      </div>

      {error && <p role="alert" className="adm-error" style={{ marginBottom: 12 }}>{error}</p>}

      {editing && (
        <form ref={formRef} onSubmit={save} className="adm-card adm-card--form adm-stack" style={{ marginBottom: 22, scrollMarginTop: 16 }}>
          <h2 ref={headingRef} tabIndex={-1} className="adm-h2">{editing.id ? `Edit ${editing.saved.name || 'golf day'}` : 'New golf day'}</h2>
          <div className="adm-row">
            <label className="adm-field">
              Link
              {editing.id ? (
                <span className="adm-input adm-mono" style={{ background: 'var(--surface)' }}>{golfDayPath(editing.form.slug)}</span>
              ) : (
                <span className="adm-mono" style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                  /golf-day/
                  <input required value={editing.form.slug} onChange={e => setField('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="bombsquad" maxLength={40} className="adm-input adm-mono" style={{ width: 170 }} />
                </span>
              )}
            </label>
            <label className="adm-field" style={{ flex: '1 1 240px' }}>
              Name
              <input required value={editing.form.name} onChange={e => setField('name', e.target.value)} placeholder="Bomb Squad Golf Day" maxLength={80} className="adm-input" />
            </label>
            <label className="adm-field">
              Tab label <span className="adm-hint">7 fits best, 12 max</span>
              <input required value={editing.form.tabLabel} onChange={e => setField('tabLabel', e.target.value)} placeholder="BS" maxLength={12} className="adm-input" style={{ width: 140 }} />
            </label>
          </div>
          <div className="adm-row">
            <label className="adm-field">
              Played on
              <input type="date" required value={editing.form.playsOn} onChange={e => setField('playsOn', e.target.value)} className="adm-input" />
            </label>
            <label className="adm-field">
              Prize (R)
              <input type="number" required min={1} max={1000000} value={editing.form.prizeRand} onChange={e => setField('prizeRand', e.target.value)} className="adm-input" style={{ width: 140 }} />
            </label>
            <label className="adm-field">
              Players
              <input type="number" required min={1} max={5000} value={editing.form.maxPlayers} onChange={e => setField('maxPlayers', e.target.value)} className="adm-input" style={{ width: 110 }} />
            </label>
            <label className="adm-field" style={{ flex: '1 1 280px' }}>
              Note
              <input value={editing.form.note} onChange={e => setField('note', e.target.value)} placeholder="Organiser, venue, anything to remember" maxLength={200} className="adm-input" />
            </label>
          </div>
          <div className="adm-field">
            Holes <span className="adm-hint">Par 3s of 140 m or more; one per course the day is played on</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {editing.form.holeIds.map(id => (
                <span key={id} className="adm-chip">
                  {holeLabel.get(id) ?? id}
                  <button type="button" onClick={() => setField('holeIds', editing.form.holeIds.filter(h => h !== id))} aria-label="Remove hole">×</button>
                </span>
              ))}
              {editing.form.holeIds.length === 0 && <span className="adm-hint">None yet</span>}
            </div>
            <div className="adm-row">
              <select value={pickCourse} onChange={e => setPickCourse(e.target.value)} disabled={coursesLoading || coursesFailed} className="adm-input" style={{ minWidth: 280 }} aria-label="Course">
                <option value="">{coursesLoading ? 'Loading courses…' : 'Course…'}</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value="" onChange={e => { if (e.target.value && !editing.form.holeIds.includes(e.target.value)) setField('holeIds', [...editing.form.holeIds, e.target.value]) }} disabled={!pickCourse} className="adm-input" aria-label="Add a hole">
                <option value="">Add a hole…</option>
                {pickable.map(h => <option key={h.id} value={h.id}>Hole {h.hole_number} · par {h.par} · {h.distance_metres} m</option>)}
              </select>
            </div>
            {coursesFailed && (
              <span role="alert" className="adm-error" style={{ fontWeight: 400 }}>
                The courses could not be loaded, so no hole can be added.{' '}
                <button type="button" onClick={() => setCourseAttempt(n => n + 1)} className="adm-link">Try again</button>
              </span>
            )}
          </div>
          <fieldset className="adm-fieldset">
            <legend className="adm-h3">Look</legend>
            <LookEditor
              form={editing.form.look}
              onChange={look => setField('look', look)}
              name={editing.form.name.trim()}
              prizeZAR={Number(editing.form.prizeRand)}
              playsOn={editing.form.playsOn || todayInSouthAfrica()}
              holes={editing.form.holeIds.map(id => holeById.get(id)).filter((h): h is GolfDayHole => Boolean(h))}
            />
          </fieldset>
          {formError && <p role="alert" className="adm-error" style={{ margin: 0 }}>{formError}</p>}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="submit" disabled={busy || editing.form.holeIds.length === 0} className="adm-btn">
              {busy ? 'Saving…' : editing.id ? 'Save changes' : 'Create golf day'}
            </button>
            <button type="button" onClick={() => leave({ to: 'close' })} disabled={busy} className="adm-btn adm-btn--quiet">Cancel</button>
          </div>
          <p className="adm-small" style={{ margin: 0 }}>
            The link cannot change once made, because it has been sent out. The look changes the moment you save, for everyone.
            Only a drawn tab icon (Bomb Squad&rsquo;s bomb) is added in code; any other golf day&rsquo;s tab shows a flag.
          </p>
        </form>
      )}

      {loading ? (
        <p className="adm-muted">Loading…</p>
      ) : !rows ? (
        <LoadError what="The golf days" onRetry={() => setAttempt(n => n + 1)} detail={list.detail} />
      ) : rows.length === 0 ? (
        <div className="adm-card" style={{ textAlign: 'center', padding: 36 }}>
          <p className="adm-h2" style={{ marginBottom: 6 }}>No golf days yet</p>
          <p className="adm-muted" style={{ margin: 0 }}>Make the first one with New golf day.</p>
        </div>
      ) : rows.map(r => {
        const phase = r.disabledAt ? { label: 'Off', pill: 'adm-pill adm-pill--red' } : PHASE[r.phase]
        return (
          <div key={r.id} className="adm-card">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h2 className="adm-h2">{r.name}</h2>
                  <span className={phase.pill}>{phase.label}</span>
                </div>
                <p style={{ fontSize: 14, margin: '8px 0 0' }}>
                  <strong>{showDate(r.playsOn)}</strong> · {formatRand(r.prizeZAR)} · tab &ldquo;{r.tabLabel}&rdquo;
                </p>
                <p className="adm-muted" style={{ fontSize: 13, margin: '4px 0 0' }}>{r.holes.map(h => `${h.course.name}, hole ${h.holeNumber}`).join(' · ') || 'No holes'}</p>
                <p className="adm-mono" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0', fontWeight: 600, wordBreak: 'break-all' }}>
                  {origin}{golfDayPath(r.slug)}
                  <button type="button" onClick={() => copy(r.id, `${origin}${golfDayPath(r.slug)}`)} title="Copy the link" aria-label="Copy the link" className="adm-icon-btn" style={{ width: 30, height: 30 }}>
                    {copied === r.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </p>
                {r.note && <p className="adm-small" style={{ margin: '6px 0 0' }}>{r.note}</p>}
                {checks(r).map(c => (
                  <p key={c.text} className="adm-warn" style={{ margin: '8px 0 0' }}>
                    <AlertTriangle size={14} aria-hidden /> {c.text}
                    {c.href && <a href={c.href} style={{ fontWeight: 700 }}>{c.action}</a>}
                  </p>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
                <Stat label="Joined" value={`${r.players} of ${r.maxPlayers}`} />
                <Stat label="Swings" value={String(r.swings)} />
                <Stat label="Claims" value={String(r.claimed)} alert={r.claimed > 0} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" title="WhatsApp message for players" aria-label="WhatsApp message for players" onClick={() => toggleMessage(r)} className="adm-icon-btn" aria-pressed={message?.id === r.id}><MessageCircle size={17} /></button>
                  <button type="button" title="Players" aria-label="Players" onClick={() => showPlayers(r)} className="adm-icon-btn" aria-pressed={players?.id === r.id}><Users size={17} /></button>
                  <button type="button" title="Edit" aria-label={`Edit ${r.name}`} onClick={() => leave({ to: 'edit', row: r })} className="adm-icon-btn"><Pencil size={17} /></button>
                  <button type="button" title={r.disabledAt ? 'Switch on' : 'Switch off'} aria-label={r.disabledAt ? `Switch ${r.name} on` : `Switch ${r.name} off`} onClick={() => (r.disabledAt ? void switchOn(r) : ask('off', r))} className={`adm-icon-btn${r.disabledAt ? ' adm-icon-btn--ok' : ' adm-icon-btn--warn'}`}><Power size={17} /></button>
                  {r.players === 0 && r.swings === 0 && (
                    <button type="button" title="Delete" aria-label={`Delete ${r.name}`} onClick={() => ask('delete', r)} className="adm-icon-btn" style={{ color: 'var(--red)' }}><Trash2 size={17} /></button>
                  )}
                </div>
              </div>
            </div>

            {message?.id === r.id && (
              <div className="adm-stack" style={{ marginTop: 16, paddingTop: 14, borderTop: '2px solid var(--surface)', maxWidth: 600 }}>
                <label className="adm-field">
                  Message for players <span className="adm-hint">WhatsApp: *bold*. Change anything before you copy it.</span>
                  <textarea value={message.text} onChange={e => setMessage({ id: r.id, text: e.target.value })} rows={12} className="adm-input" />
                </label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button type="button" onClick={() => copy(`msg-${r.id}`, message.text)} className="adm-btn adm-btn--green">
                    {copied === `msg-${r.id}` ? <Check size={15} /> : <Copy size={15} />} {copied === `msg-${r.id}` ? 'Copied' : 'Copy message'}
                  </button>
                  <button type="button" onClick={() => setMessage({ id: r.id, text: golfDayMessage(r, { site: origin, venue: themeFor(r.slug, r.look).venue }) })} className="adm-btn adm-btn--quiet">
                    Start again
                  </button>
                </div>
              </div>
            )}

            {players?.id === r.id && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: '2px solid var(--surface)', overflowX: 'auto' }}>
                {players.list === null ? (
                  <p className="adm-muted">Loading players…</p>
                ) : players.failed ? (
                  <p className="adm-error">The players could not be loaded. Close and open the list to try again.</p>
                ) : players.list.length === 0 ? (
                  <p className="adm-muted">Nobody has joined yet.</p>
                ) : (
                  <table className="adm-table">
                    <thead>
                      <tr><th>Player</th><th>Email</th><th>Joined</th><th>Swing</th></tr>
                    </thead>
                    <tbody>
                      {players.list.map(p => (
                        <tr key={p.userId}>
                          <td style={{ fontWeight: 600 }}>{p.name ?? '—'}</td>
                          <td className="adm-muted">{p.email ?? '—'}</td>
                          <td className="adm-muted">{new Date(p.joinedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                          <td>
                            {p.swing
                              ? <span className={p.swing.status === 'claimed' ? 'adm-pill adm-pill--red' : 'adm-pill'}>{SWING[p.swing.status] ?? p.swing.status}{p.swing.hole ? ` · ${p.swing.hole}` : ''}</span>
                              : <span className="adm-muted">Not taken</span>}
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

      <p className="adm-small" style={{ marginTop: 16, maxWidth: 720 }}>
        A golf day&rsquo;s prize is Get Lucky&rsquo;s own, not Indwe&rsquo;s. Its swings go through the same claim and review as any entry, and a claim shows up in the Verification Queue.
      </p>

      <ConfirmModal
        open={confirming !== null}
        title={confirming?.action === 'delete' ? `Delete ${confirming.row.name}?` : `Switch ${confirming?.row.name ?? ''} off?`}
        message={confirming?.action === 'delete'
          ? `Nobody has joined it, so nothing is lost. ${golfDayPath(confirming.row.slug)} stops working, and the name is free for another golf day.`
          : 'Its tab disappears and nobody can take a swing until you switch it on again.'}
        confirmLabel={confirming?.action === 'delete' ? 'Delete' : 'Switch off'}
        onConfirm={confirm}
        onCancel={() => setConfirming(null)}
        busy={confirmBusy}
        error={confirmError}
      />
      <ConfirmModal
        open={leaving !== null}
        title="Throw away your changes?"
        message={`Your changes to ${editing?.id ? editing.saved.name : 'the new golf day'} have not been saved${newPicture ? ', including the picture you uploaded' : ''}.`}
        confirmLabel="Throw away"
        onConfirm={() => { if (leaving) go(leaving) }}
        onCancel={() => setLeaving(null)}
      />
    </div>
  )
}

/** What still needs doing for a golf day that is not over: a course nobody can confirm a claim at, a tab label too long. */
function checks(r: AdminGolfDay): { text: string; href?: string; action?: string }[] {
  if (r.phase === 'over') return []
  const out: { text: string; href?: string; action?: string }[] = r.missingOfficials.map(course => ({
    text: `No club official for ${course}: a claim there has nobody to confirm it.`,
    href: '/admin/courses',
    action: 'Add one in Courses → Contacts',
  }))
  if (r.tabLabel.length > 7) out.push({ text: `The tab label is ${r.tabLabel.length} characters. Over 7 it is shrunk, and can be cut short on small phones.` })
  return out
}

function Stat({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="adm-stat">
      <div className="adm-stat-label">{label}</div>
      <div className={`adm-stat-value${alert ? ' adm-stat-value--alert' : ''}`}>{value}</div>
    </div>
  )
}
