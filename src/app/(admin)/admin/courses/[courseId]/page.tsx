'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Save, Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'
import type { CourseRow, HoleRow } from '@/types/admin'

const REGIONS = ['Western Cape', 'Gauteng', 'KwaZulu-Natal', 'Mpumalanga', 'North West', 'Eastern Cape', 'Free State', 'Limpopo', 'Northern Cape']

export default function AdminEditCoursePage() {
  const params = useParams()
  const router = useRouter()
  const courseId = params.courseId as string

  const [course, setCourse] = useState<CourseRow | null>(null)
  const [holes, setHoles] = useState<HoleRow[]>([])
  type ContactRow = { id: string; name: string; email: string; role: string; created_at: string }
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [newContact, setNewContact] = useState({ name: '', email: '' })
  const [contactError, setContactError] = useState('')
  const [addingContact, setAddingContact] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [newHole, setNewHole] = useState({ hole_number: '', par: '3', distance_metres: '' })
  const [addingHole, setAddingHole] = useState(false)
  // Coordinates are edited as text so a half-typed "-33." is not a NaN in state.
  const [coords, setCoords] = useState({ lat: '', lng: '' })

  useEffect(() => {
    fetch(`/api/admin/courses/${courseId}`)
      .then(r => r.json())
      .then(data => {
        setCourse(data.course)
        setCoords({ lat: data.course?.lat != null ? String(data.course.lat) : '', lng: data.course?.lng != null ? String(data.course.lng) : '' })
        setHoles(data.holes || [])
        setContacts(data.contacts || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [courseId])

  const handleSave = async () => {
    if (!course) return
    setSaving(true)
    setError('')
    const parseCoord = (v: string) => (v.trim() === '' ? null : Number(v))
    const lat = parseCoord(coords.lat)
    const lng = parseCoord(coords.lng)
    if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng)) || (lat === null) !== (lng === null)) {
      setError('Latitude and longitude must both be numbers, or both be empty')
      setSaving(false)
      return
    }
    try {
      const res = await fetch(`/api/admin/courses/${courseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: course.name,
          location_text: course.location_text,
          region: course.region,
          is_partner: course.is_partner,
          lat,
          lng,
        }),
      })
      const data = await res.json()
      if (!data.success) setError(data.error || 'Save failed')
      else {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } catch {
      setError('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleAddContact = async () => {
    setAddingContact(true)
    setContactError('')
    try {
      const res = await fetch(`/api/admin/courses/${courseId}/contacts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newContact),
      })
      const data = await res.json()
      if (!res.ok) setContactError(data.error || 'Could not add the contact')
      else {
        setContacts([...contacts, data.contact])
        setNewContact({ name: '', email: '' })
      }
    } catch {
      setContactError('Could not add the contact')
    } finally {
      setAddingContact(false)
    }
  }

  const removeContact = async (id: string) => {
    await fetch(`/api/admin/courses/${courseId}/contacts?id=${id}`, { method: 'DELETE' })
    setContacts(contacts.filter(c => c.id !== id))
  }

  const handleAddHole = async () => {
    setAddingHole(true)
    try {
      const res = await fetch(`/api/admin/courses/${courseId}/holes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hole_number: parseInt(newHole.hole_number),
          par: parseInt(newHole.par),
          distance_metres: newHole.distance_metres ? parseInt(newHole.distance_metres) : null,
        }),
      })
      if (res.ok) {
        setNewHole({ hole_number: '', par: '3', distance_metres: '' })
        // Refresh holes
        const data = await fetch(`/api/admin/courses/${courseId}`).then(r => r.json())
        setHoles(data.holes || [])
      }
    } catch { /* ignore */ } finally {
      setAddingHole(false)
    }
  }

  const toggleHoleActive = async (holeId: string, currentActive: boolean) => {
    await fetch(`/api/admin/courses/${courseId}/holes/${holeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !currentActive }),
    })
    setHoles(holes.map(h => h.id === holeId ? { ...h, is_active: !currentActive } : h))
  }

  const deleteHole = async (holeId: string) => {
    await fetch(`/api/admin/courses/${courseId}/holes/${holeId}`, { method: 'DELETE' })
    setHoles(holes.filter(h => h.id !== holeId))
  }

  if (loading) return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ width: 70, height: 32, background: '#e5e5e5', borderRadius: 6 }} />
        <div style={{ width: '30%', height: 20, background: '#e5e5e5', borderRadius: 4 }} />
      </div>
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 24, marginBottom: 24, height: 280 }} />
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 24, height: 200 }} />
    </div>
  )
  if (!course) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Course not found</div>

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #e5e5e5',
    fontSize: 14,
    color: '#111',
    fontFamily: "'Inter', system-ui, sans-serif",
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => router.push('/admin/courses')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 6, border: '1px solid #e5e5e5',
            background: '#fff', cursor: 'pointer', color: '#333', fontSize: 13,
          }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111', fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>Edit: {course.name}</h1>
      </div>

      {/* Course details form */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 16 }}>Course Details</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>Name</label>
            <input type="text" value={course.name} onChange={(e) => setCourse({ ...course, name: e.target.value })} style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>Location</label>
              <input type="text" value={course.location_text || ''} onChange={(e) => setCourse({ ...course, location_text: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>Region</label>
              <select value={course.region || ''} onChange={(e) => setCourse({ ...course, region: e.target.value })} style={inputStyle}>
                <option value="">Select region</option>
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>Latitude</label>
              <input type="text" inputMode="decimal" value={coords.lat} onChange={(e) => setCoords({ ...coords, lat: e.target.value })} placeholder="-33.96" style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6 }}>Longitude</label>
              <input type="text" inputMode="decimal" value={coords.lng} onChange={(e) => setCoords({ ...coords, lng: e.target.value })} placeholder="22.38" style={inputStyle} />
            </div>
          </div>
          <p style={{ fontSize: 12, color: '#999', margin: '-6px 0 0' }}>Used to measure how far from the course a claim&apos;s footage was recorded. Google Maps → right-click the clubhouse → the first line is “lat, lng”.</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#333', cursor: 'pointer' }}>
            <input type="checkbox" checked={course.is_partner} onChange={(e) => setCourse({ ...course, is_partner: e.target.checked })} style={{ width: 18, height: 18 }} />
            Partner course
          </label>
        </div>

        {error && <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: '#fde8e8', color: '#c0392b', fontSize: 13 }}>{error}</div>}

        {saved && (
          <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: '#e6f4ea', color: '#1a7f37', fontSize: 13, fontWeight: 500 }}>
            Changes saved successfully
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: '#335231', color: '#fff', fontSize: 14,
              cursor: 'pointer', fontWeight: 600,
            }}
          >
            <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Club contacts */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 4 }}>Club contacts ({contacts.length})</h3>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
          Every hole-in-one claim at this course emails these people a one-tap question: did the club issue the certificate? Independent of what the golfer uploads.
        </p>
        {contacts.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
            <tbody>
              {contacts.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 500, color: '#111' }}>{c.name}</td>
                  <td style={{ padding: '8px 10px', color: '#666' }}>{c.email}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <button onClick={() => removeContact(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b' }} title="Remove">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ borderTop: contacts.length ? '1px solid #e5e5e5' : 'none', paddingTop: contacts.length ? 16 : 0, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4 }}>Name</label>
            <input type="text" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} placeholder="Club manager" style={inputStyle} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4 }}>Email</label>
            <input type="email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} placeholder="manager@club.co.za" style={inputStyle} />
          </div>
          <button
            onClick={handleAddContact}
            disabled={addingContact || !newContact.name || !newContact.email}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '10px 16px', borderRadius: 8, border: 'none', background: '#335231', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            <Plus size={14} /> Add contact
          </button>
        </div>
        {contactError && <div style={{ marginTop: 10, fontSize: 13, color: '#c0392b' }}>{contactError}</div>}
      </div>

      {/* Holes management */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>Par-3 Holes ({holes.length})</h3>
        </div>

        {holes.length === 0 ? (
          <p style={{ color: '#999', fontSize: 13, marginBottom: 16 }}>No holes added yet</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e5e5' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Hole #</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Par</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Distance (m)</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Active</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {holes.map((hole) => (
                <tr key={hole.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 500, color: '#111' }}>Hole {hole.hole_number}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#666' }}>{hole.par}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#666' }}>{hole.distance_metres ?? '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <button
                      onClick={() => toggleHoleActive(hole.id, hole.is_active)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: hole.is_active ? '#1a7f37' : '#ccc' }}
                    >
                      {hole.is_active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                    </button>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <button
                      onClick={() => deleteHole(hole.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Add hole form */}
        <div style={{ borderTop: '1px solid #e5e5e5', paddingTop: 16, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4 }}>Hole #</label>
            <input type="number" value={newHole.hole_number} onChange={(e) => setNewHole({ ...newHole, hole_number: e.target.value })} placeholder="4" style={{ ...inputStyle, width: 70 }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4 }}>Par</label>
            <input type="number" value={newHole.par} onChange={(e) => setNewHole({ ...newHole, par: e.target.value })} style={{ ...inputStyle, width: 60 }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4 }}>Distance (m)</label>
            <input type="number" value={newHole.distance_metres} onChange={(e) => setNewHole({ ...newHole, distance_metres: e.target.value })} placeholder="155" style={{ ...inputStyle, width: 90 }} />
          </div>
          <button
            onClick={handleAddHole}
            disabled={addingHole || !newHole.hole_number}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '10px 16px', borderRadius: 8, border: 'none',
              background: '#335231', color: '#fff', fontSize: 13,
              cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >
            <Plus size={14} /> Add Hole
          </button>
        </div>
      </div>
    </div>
  )
}
