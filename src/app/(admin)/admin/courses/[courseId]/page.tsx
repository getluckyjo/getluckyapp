'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import ConfirmModal from '@/components/admin/ConfirmModal'
import LoadError from '@/components/admin/LoadError'
import type { CourseRow, HoleRow } from '@/types/admin'
import { MIN_HOLE_METRES, holeUnavailableReason } from '@/lib/holes'
import { OFFLINE, REGIONS, parseCoords, reasonFrom } from '../course-fields'

type ContactRow = { id: string; name: string; email: string; role: string; created_at: string }

/** The course fields the form edits, as typed (coordinates as text so a half-typed "-33." is not NaN). */
interface CourseForm { name: string; location_text: string; region: string; is_partner: boolean; lat: string; lng: string }

const formFrom = (c: CourseRow): CourseForm => ({
  name: c.name,
  location_text: c.location_text ?? '',
  region: c.region ?? '',
  is_partner: c.is_partner,
  lat: c.lat != null ? String(c.lat) : '',
  lng: c.lng != null ? String(c.lng) : '',
})

/** A change that needs a yes first: it takes something away that golfers or claims rely on. */
interface Pending { title: string; message: string; confirmLabel: string; section: 'contacts' | 'holes'; request: () => Promise<Response> }

const STALE = 'Saved, but the list could not be refreshed. Reload the page to see it.'

const send = (url: string, method: string, body?: unknown) => fetch(url, {
  method,
  headers: body ? { 'Content-Type': 'application/json' } : undefined,
  body: body ? JSON.stringify(body) : undefined,
})

export default function AdminEditCoursePage() {
  const params = useParams()
  const courseId = params.courseId as string

  // `course` is the saved copy (the heading, the warnings); `form` is what is being typed.
  const [course, setCourse] = useState<CourseRow | null>(null)
  const [form, setForm] = useState<CourseForm | null>(null)
  const [holes, setHoles] = useState<HoleRow[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [loadError, setLoadError] = useState<{ notFound: boolean; detail: string | null } | null>(null)
  const [attempt, setAttempt] = useState(0)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [newContact, setNewContact] = useState({ name: '', email: '' })
  const [contactError, setContactError] = useState('')
  const [addingContact, setAddingContact] = useState(false)

  const [newHole, setNewHole] = useState({ hole_number: '', par: '3', distance_metres: '' })
  const [holeError, setHoleError] = useState('')
  const [addingHole, setAddingHole] = useState(false)
  const [holeEdit, setHoleEdit] = useState<{ id: string; par: string; distance: string } | null>(null)
  const [holeEditError, setHoleEditError] = useState('')
  const [holeBusy, setHoleBusy] = useState<string | null>(null)

  const [pending, setPending] = useState<Pending | null>(null)
  const [pendingBusy, setPendingBusy] = useState(false)
  const [pendingError, setPendingError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/courses/${courseId}`)
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) { setLoadError({ notFound: res.status === 404, detail: json.error ?? null }); return }
        setLoadError(null)
        setCourse(json.course)
        setForm(formFrom(json.course))
        setHoles(json.holes ?? [])
        setContacts(json.contacts ?? [])
      })
      .catch(() => { if (!cancelled) setLoadError({ notFound: false, detail: OFFLINE }) })
    return () => { cancelled = true }
  }, [courseId, attempt])

  /** Re-read the holes and officials after a change, leaving the details form as typed. */
  async function refreshLists(): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/courses/${courseId}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return false
      setHoles(json.holes ?? [])
      setContacts(json.contacts ?? [])
      return true
    } catch {
      return false
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return
    const coords = parseCoords(form.lat, form.lng)
    if (!coords.ok) { setError(coords.error); return }
    setSaving(true)
    setError('')
    const fields = {
      name: form.name.trim(),
      location_text: form.location_text.trim() || null,
      region: form.region || null,
      is_partner: form.is_partner,
      lat: coords.lat,
      lng: coords.lng,
    }
    try {
      const res = await send(`/api/admin/courses/${courseId}`, 'PATCH', fields)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(reasonFrom(json, 'The changes could not be saved. Please try again.')); return }
      setCourse(c => (c ? { ...c, ...fields } : c))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError(OFFLINE)
    } finally {
      setSaving(false)
    }
  }

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddingContact(true)
    setContactError('')
    try {
      const res = await send(`/api/admin/courses/${courseId}/contacts`, 'POST', newContact)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setContactError(reasonFrom(json, 'The club official could not be added. Please try again.')); return }
      setNewContact({ name: '', email: '' })
      if (!(await refreshLists())) setContactError(STALE)
    } catch {
      setContactError(OFFLINE)
    } finally {
      setAddingContact(false)
    }
  }

  const handleAddHole = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddingHole(true)
    setHoleError('')
    try {
      const res = await send(`/api/admin/courses/${courseId}/holes`, 'POST', {
        hole_number: Number(newHole.hole_number),
        par: Number(newHole.par),
        distance_metres: newHole.distance_metres.trim() ? Number(newHole.distance_metres) : null,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setHoleError(reasonFrom(json, 'The hole could not be added. Please try again.')); return }
      setNewHole({ hole_number: '', par: '3', distance_metres: '' })
      if (!(await refreshLists())) setHoleError(STALE)
    } catch {
      setHoleError(OFFLINE)
    } finally {
      setAddingHole(false)
    }
  }

  const saveHoleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!holeEdit) return
    setHoleBusy(holeEdit.id)
    setHoleEditError('')
    try {
      const res = await send(`/api/admin/courses/${courseId}/holes/${holeEdit.id}`, 'PATCH', {
        par: Number(holeEdit.par),
        distance_metres: holeEdit.distance.trim() ? Number(holeEdit.distance) : null,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setHoleEditError(reasonFrom(json, 'The hole could not be saved. Please try again.')); return }
      setHoleEdit(null)
      if (!(await refreshLists())) setHoleError(STALE)
    } catch {
      setHoleEditError(OFFLINE)
    } finally {
      setHoleBusy(null)
    }
  }

  /** Put a hole back on sale at once; taking one off asks first. */
  const setHoleActive = async (hole: HoleRow, active: boolean) => {
    if (!active) {
      ask({
        title: `Take hole ${hole.hole_number} off sale?`,
        message: 'Golfers can no longer choose it. Bets already made on it, and any claims, carry on as normal.',
        confirmLabel: 'Take off sale',
        section: 'holes',
        request: () => send(`/api/admin/courses/${courseId}/holes/${hole.id}`, 'PATCH', { is_active: false }),
      })
      return
    }
    setHoleBusy(hole.id)
    setHoleError('')
    try {
      const res = await send(`/api/admin/courses/${courseId}/holes/${hole.id}`, 'PATCH', { is_active: true })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setHoleError(reasonFrom(json, 'The hole could not be put on sale. Please try again.')); return }
      if (!(await refreshLists())) setHoleError(STALE)
    } catch {
      setHoleError(OFFLINE)
    } finally {
      setHoleBusy(null)
    }
  }

  function ask(p: Pending) {
    setPendingError(null)
    setPending(p)
  }

  async function confirmPending() {
    if (!pending) return
    setPendingBusy(true)
    setPendingError(null)
    try {
      const res = await pending.request()
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setPendingError(json.error ?? 'That did not work. Please try again.'); return }
      const { section } = pending
      setPending(null)
      if (!(await refreshLists())) (section === 'contacts' ? setContactError : setHoleError)(STALE)
    } catch {
      setPendingError(OFFLINE)
    } finally {
      setPendingBusy(false)
    }
  }

  if (loadError?.notFound) {
    return (
      <div className="adm-card" style={{ textAlign: 'center', padding: 36 }}>
        <title>Course not found · Get Lucky admin</title>
        <p className="adm-h2" style={{ marginBottom: 8 }}>Course not found</p>
        <p className="adm-muted" style={{ margin: '0 0 16px' }}>It may have been deleted.</p>
        <Link href="/admin/courses" className="adm-btn adm-btn--quiet" style={{ textDecoration: 'none' }}>Back to Courses</Link>
      </div>
    )
  }
  if (loadError) return <LoadError what="The course" detail={loadError.detail} onRetry={() => { setLoadError(null); setAttempt(n => n + 1) }} />
  if (!course || !form) return <p className="adm-muted">Loading…</p>

  const lastOfficial = contacts.length === 1
  const noOfficial = course.is_partner && contacts.length === 0

  return (
    <div style={{ maxWidth: 860 }}>
      <title>{`${course.name} · Courses · Get Lucky admin`}</title>
      <Link href="/admin/courses" className="adm-btn adm-btn--quiet" style={{ textDecoration: 'none', marginBottom: 18 }}>
        <ArrowLeft size={15} aria-hidden /> Courses
      </Link>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">{course.name}</h1>
          <p className="adm-lead">
            {course.is_partner ? 'Partner course: golfers can pay to play its holes on sale.' : 'Not a partner: golfers see it but cannot pay to play here.'}
          </p>
        </div>
        <span className={course.is_partner ? 'adm-pill adm-pill--lime' : 'adm-pill'}>{course.is_partner ? 'Partner' : 'Not a partner'}</span>
      </div>

      {noOfficial && (
        <p role="status" className="adm-warn" style={{ margin: '0 0 16px', fontSize: 13 }}>
          <AlertTriangle size={15} aria-hidden /> No club official: a hole-in-one claim here has nobody to confirm the certificate. Add one under Club officials.
        </p>
      )}

      <form onSubmit={handleSave} className="adm-card adm-stack">
        <h2 className="adm-h2">Details</h2>
        <label className="adm-field">
          Name
          <input type="text" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="adm-input" />
        </label>
        <div className="adm-grid-2">
          <label className="adm-field">
            Location
            <input type="text" maxLength={200} value={form.location_text} onChange={(e) => setForm({ ...form, location_text: e.target.value })} className="adm-input" />
          </label>
          <label className="adm-field">
            Region
            <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} className="adm-input">
              <option value="">Choose a region</option>
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>
        <div className="adm-grid-2">
          <label className="adm-field">
            Latitude
            <input type="text" inputMode="decimal" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="-33.96" className="adm-input" />
          </label>
          <label className="adm-field">
            Longitude
            <input type="text" inputMode="decimal" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="22.38" className="adm-input" />
          </label>
        </div>
        <p className="adm-hint" style={{ margin: '-6px 0 0' }}>
          Both or neither. Used to measure how far from the course a claim&apos;s footage was recorded: in Google Maps, right-click the clubhouse and copy the first line.
        </p>
        <label className="adm-check">
          <input type="checkbox" checked={form.is_partner} onChange={(e) => setForm({ ...form, is_partner: e.target.checked })} />
          Partner course <span className="adm-hint">golfers can pay to play here</span>
        </label>

        {error && <p role="alert" className="adm-error" style={{ margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button type="submit" disabled={saving} className="adm-btn">{saving ? 'Saving…' : 'Save changes'}</button>
          {saved && <span role="status" className="adm-small" style={{ fontWeight: 700, opacity: 1 }}><Check size={14} aria-hidden /> Saved</span>}
        </div>
      </form>

      <section className="adm-card adm-stack">
        <div>
          <h2 className="adm-h2">Club officials ({contacts.length})</h2>
          <p className="adm-small" style={{ margin: '6px 0 0' }}>
            Every hole-in-one claim at this course emails these people a one-tap question: did the club issue the certificate? Independent of what the golfer uploads.
          </p>
        </div>
        {contacts.length > 0 && (
          <div className="adm-table-wrap">
            <table className="adm-table" style={{ minWidth: 0 }}>
              <thead><tr><th>Name</th><th>Email</th><th style={{ textAlign: 'right' }}>Remove</th></tr></thead>
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td className="adm-muted">{c.email}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="adm-icon-btn adm-icon-btn--warn"
                        aria-label={`Remove ${c.name}`}
                        title="Remove"
                        onClick={() => ask(lastOfficial
                          ? {
                            title: 'Remove the last club official?',
                            message: `${c.name} is the only club official at ${course.name}. Until you add another, a hole-in-one claim here has nobody to confirm the certificate${course.is_partner ? ', and golfers can still pay to play here' : ''}.`,
                            confirmLabel: 'Remove anyway',
                            section: 'contacts',
                            request: () => send(`/api/admin/courses/${courseId}/contacts?id=${c.id}`, 'DELETE'),
                          }
                          : {
                            title: `Remove ${c.name}?`,
                            message: `${c.email} stops getting claim confirmations for ${course.name}. Requests already sent for open claims still count.`,
                            confirmLabel: 'Remove',
                            section: 'contacts',
                            request: () => send(`/api/admin/courses/${courseId}/contacts?id=${c.id}`, 'DELETE'),
                          })}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form onSubmit={handleAddContact} className="adm-row">
          <label className="adm-field" style={{ flex: '1 1 180px' }}>
            Name
            <input type="text" required minLength={2} maxLength={80} value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} placeholder="Club manager" className="adm-input" />
          </label>
          <label className="adm-field" style={{ flex: '1 1 220px' }}>
            Email
            <input type="email" required maxLength={200} value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} placeholder="manager@club.co.za" className="adm-input" />
          </label>
          <button type="submit" disabled={addingContact} className="adm-btn adm-btn--green">
            <Plus size={14} aria-hidden /> {addingContact ? 'Adding…' : 'Add official'}
          </button>
        </form>
        {contactError && <p role="alert" className="adm-error" style={{ margin: 0 }}>{contactError}</p>}
      </section>

      <section className="adm-card adm-stack">
        <div>
          <h2 className="adm-h2">Holes ({holes.length})</h2>
          <p className="adm-small" style={{ margin: '6px 0 0' }}>
            Golfers can play a hole that is on sale, a par 3, and {MIN_HOLE_METRES} m or more. The distance is the eligibility, so keep it right.
          </p>
        </div>
        {holes.length === 0 ? (
          <p className="adm-muted" style={{ margin: 0 }}>No holes yet. Add the par 3s below.</p>
        ) : (
          <form onSubmit={saveHoleEdit} className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Hole</th>
                  <th>Par</th>
                  <th>Distance</th>
                  <th>Playable</th>
                  <th>On sale</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {holes.map((hole) => {
                  const editing = holeEdit?.id === hole.id
                  const reason = holeUnavailableReason(hole)
                  return (
                    <tr key={hole.id}>
                      <td style={{ fontWeight: 700 }}>Hole {hole.hole_number}</td>
                      <td>
                        {editing ? (
                          <input type="number" required min={3} max={5} step={1} value={holeEdit.par} onChange={e => setHoleEdit({ ...holeEdit, par: e.target.value })} aria-label={`Par for hole ${hole.hole_number}`} className="adm-input" style={{ width: 72 }} />
                        ) : hole.par}
                      </td>
                      <td>
                        {editing ? (
                          <input type="number" min={30} max={400} step={1} value={holeEdit.distance} onChange={e => setHoleEdit({ ...holeEdit, distance: e.target.value })} placeholder="m" aria-label={`Distance in metres for hole ${hole.hole_number}`} className="adm-input" style={{ width: 96 }} />
                        ) : hole.distance_metres != null ? `${hole.distance_metres} m` : '—'}
                      </td>
                      <td>
                        {reason
                          ? <span className="adm-pill adm-pill--amber">{reason}</span>
                          : <span className="adm-pill adm-pill--lime">Yes</span>}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setHoleActive(hole, !hole.is_active)}
                          disabled={holeBusy === hole.id}
                          className={hole.is_active ? 'adm-pill adm-pill--green' : 'adm-pill'}
                          style={{ border: 'none', cursor: 'pointer' }}
                          aria-label={hole.is_active ? `Hole ${hole.hole_number} is on sale. Take it off sale` : `Hole ${hole.hole_number} is off sale. Put it on sale`}
                        >
                          {hole.is_active ? 'On sale' : 'Off sale'}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {editing ? (
                            <>
                              <button type="submit" disabled={holeBusy === hole.id} className="adm-icon-btn adm-icon-btn--ok" aria-label={`Save hole ${hole.hole_number}`} title="Save"><Check size={16} /></button>
                              <button type="button" onClick={() => { setHoleEdit(null); setHoleEditError('') }} className="adm-icon-btn" aria-label="Cancel" title="Cancel"><X size={16} /></button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => { setHoleEditError(''); setHoleEdit({ id: hole.id, par: String(hole.par), distance: hole.distance_metres != null ? String(hole.distance_metres) : '' }) }}
                                className="adm-icon-btn"
                                aria-label={`Edit par and distance of hole ${hole.hole_number}`}
                                title="Edit par and distance"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => ask({
                                  title: `Delete hole ${hole.hole_number}?`,
                                  message: 'A hole with bets cannot be deleted; take it off sale instead.',
                                  confirmLabel: 'Delete hole',
                                  section: 'holes',
                                  request: () => send(`/api/admin/courses/${courseId}/holes/${hole.id}`, 'DELETE'),
                                })}
                                className="adm-icon-btn adm-icon-btn--warn"
                                aria-label={`Delete hole ${hole.hole_number}`}
                                title="Delete"
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {holeEditError && <p role="alert" className="adm-error" style={{ margin: '10px 0 0' }}>{holeEditError}</p>}
          </form>
        )}

        <form onSubmit={handleAddHole} className="adm-row" style={{ paddingTop: 14, borderTop: '2px solid var(--surface)' }}>
          <label className="adm-field">
            Hole number
            <input type="number" required min={1} max={18} step={1} value={newHole.hole_number} onChange={(e) => setNewHole({ ...newHole, hole_number: e.target.value })} placeholder="4" className="adm-input" style={{ width: 110 }} />
          </label>
          <label className="adm-field">
            Par
            <input type="number" required min={3} max={5} step={1} value={newHole.par} onChange={(e) => setNewHole({ ...newHole, par: e.target.value })} className="adm-input" style={{ width: 80 }} />
          </label>
          <label className="adm-field">
            Distance (m)
            <input type="number" min={30} max={400} step={1} value={newHole.distance_metres} onChange={(e) => setNewHole({ ...newHole, distance_metres: e.target.value })} placeholder="155" className="adm-input" style={{ width: 110 }} />
          </label>
          <button type="submit" disabled={addingHole} className="adm-btn adm-btn--green">
            <Plus size={14} aria-hidden /> {addingHole ? 'Adding…' : 'Add hole'}
          </button>
        </form>
        {holeError && <p role="alert" className="adm-error" style={{ margin: 0 }}>{holeError}</p>}
      </section>

      <ConfirmModal
        open={pending !== null}
        title={pending?.title ?? ''}
        message={pending?.message ?? ''}
        confirmLabel={pending?.confirmLabel}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
        busy={pendingBusy}
        error={pendingError}
      />
    </div>
  )
}
