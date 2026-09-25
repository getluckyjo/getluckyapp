'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { OFFLINE, REGIONS, parseCoords, reasonFrom } from '../course-fields'

export default function AdminNewCoursePage() {
  const router = useRouter()
  const [form, setForm] = useState({
    name: '',
    location_text: '',
    region: '',
    lat: '',
    lng: '',
    is_partner: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Give the course a name.'); return }
    const coords = parseCoords(form.lat, form.lng)
    if (!coords.ok) { setError(coords.error); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          location_text: form.location_text.trim() || null,
          region: form.region || null,
          is_partner: form.is_partner,
          lat: coords.lat,
          lng: coords.lng,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.id) { setError(reasonFrom(data, 'The course could not be created. Please try again.')); return }
      // Straight to the course, where its holes and club officials are added.
      router.push(`/admin/courses/${data.id}`)
    } catch {
      setError(OFFLINE)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <title>New course · Get Lucky admin</title>
      <Link href="/admin/courses" className="adm-btn adm-btn--quiet" style={{ textDecoration: 'none', marginBottom: 18 }}>
        <ArrowLeft size={15} aria-hidden /> Courses
      </Link>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">New course</h1>
          <p className="adm-lead">Holes and club officials are added on the next page.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="adm-card adm-card--form adm-stack">
        <label className="adm-field">
          Course name
          <input
            type="text"
            required
            maxLength={120}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Leopard Creek Country Club"
            className="adm-input"
          />
        </label>
        <div className="adm-grid-2">
          <label className="adm-field">
            Location
            <input
              type="text"
              maxLength={200}
              value={form.location_text}
              onChange={(e) => setForm({ ...form, location_text: e.target.value })}
              placeholder="Malelane, Mpumalanga"
              className="adm-input"
            />
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
          <button type="submit" disabled={saving} className="adm-btn">
            {saving ? 'Creating…' : 'Create course'}
          </button>
          <Link href="/admin/courses" className="adm-btn adm-btn--quiet" style={{ textDecoration: 'none' }}>Cancel</Link>
        </div>
      </form>
    </div>
  )
}
