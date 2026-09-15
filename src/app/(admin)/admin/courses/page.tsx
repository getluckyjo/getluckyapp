'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Edit, Trash2, MapPin, CheckCircle, XCircle } from 'lucide-react'
import SearchInput from '@/components/admin/SearchInput'
import Pagination from '@/components/admin/Pagination'
import ConfirmModal from '@/components/admin/ConfirmModal'
import type { AdminCourseRecord, PaginatedResponse } from '@/types/admin'

export default function AdminCoursesPage() {
  const router = useRouter()
  const [data, setData] = useState<AdminCourseRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [partnerFilter, setPartnerFilter] = useState('')
  const [deleteModal, setDeleteModal] = useState<string | null>(null)

  // Loading is derived: the page is loading until the query it currently
  // shows has been answered, so no state is set synchronously in an effect.
  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '20' })
    if (search) params.set('search', search)
    if (partnerFilter) params.set('partner', partnerFilter)
    return params.toString()
  }, [page, search, partnerFilter])
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null)
  const loading = loadedQuery !== query
  // Bumped after an edit so the list re-fetches without changing the query.
  const [refresh, setRefresh] = useState(0)
  const reload = () => setRefresh(n => n + 1)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/courses?${query}`)
      .then(res => res.json() as Promise<PaginatedResponse<AdminCourseRecord>>)
      .then(json => {
        if (cancelled) return
        setData(json.data || [])
        setTotal(json.total || 0)
        setTotalPages(json.totalPages || 1)
      })
      .catch(() => { if (!cancelled) setData([]) })
      .finally(() => { if (!cancelled) setLoadedQuery(query) })
    return () => { cancelled = true }
  }, [query, refresh])

  const togglePartner = async (courseId: string, currentValue: boolean) => {
    await fetch(`/api/admin/courses/${courseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_partner: !currentValue }),
    })
    reload()
  }

  const handleDelete = async () => {
    if (!deleteModal) return
    await fetch(`/api/admin/courses/${deleteModal}`, { method: 'DELETE' })
    setDeleteModal(null)
    reload()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>Course Management</h1>
          <p style={{ fontSize: 14, color: '#666' }}>Manage golf courses and their par-3 holes</p>
        </div>
        <button
          onClick={() => router.push('/admin/courses/new')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            borderRadius: 8, border: 'none', background: '#335231', color: '#fff',
            fontSize: 13, cursor: 'pointer', fontWeight: 600,
          }}
        >
          <Plus size={14} /> Add Course
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <SearchInput
          placeholder="Search courses..."
          value={search}
          onChange={(v) => { setSearch(v); setPage(1) }}
        />
        <select
          value={partnerFilter}
          onChange={(e) => { setPartnerFilter(e.target.value); setPage(1) }}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, color: '#333', background: '#fff' }}
        >
          <option value="">All courses</option>
          <option value="true">Partners only</option>
          <option value="false">Non-partners</option>
        </select>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Course</th>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Location</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Partner</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Holes</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Active Holes</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Total Bets</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} style={{ padding: 14 }}>
                      <div style={{ height: 16, background: '#f0f0f0', borderRadius: 4, width: '60%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#999' }}>No courses found</td></tr>
            ) : (
              data.map((course) => (
                <tr key={course.id} className="admin-tr" style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <MapPin size={16} color="#335231" />
                      <span style={{ fontWeight: 500, color: '#111' }}>{course.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px 14px', color: '#666' }}>{course.location_text || course.region || '—'}</td>
                  <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                    <button
                      onClick={() => togglePartner(course.id, course.is_partner)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: course.is_partner ? '#1a7f37' : '#ccc',
                      }}
                      title={course.is_partner ? 'Partner — click to remove' : 'Not a partner — click to add'}
                    >
                      {course.is_partner ? <CheckCircle size={18} /> : <XCircle size={18} />}
                    </button>
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'center', color: '#111' }}>{course.holeCount}</td>
                  <td style={{ padding: '12px 14px', textAlign: 'center', color: '#1a7f37', fontWeight: 500 }}>{course.activeHoleCount}</td>
                  <td style={{ padding: '12px 14px', textAlign: 'center', color: '#111' }}>{course.totalBets}</td>
                  <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <button
                        onClick={() => router.push(`/admin/courses/${course.id}`)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                          borderRadius: 6, border: '1px solid #e5e5e5', background: '#fff',
                          fontSize: 12, cursor: 'pointer', color: '#335231',
                        }}
                      >
                        <Edit size={12} /> Edit
                      </button>
                      <button
                        onClick={() => setDeleteModal(course.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                          borderRadius: 6, border: '1px solid #fde8e8', background: '#fff',
                          fontSize: 12, cursor: 'pointer', color: '#c0392b',
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      <ConfirmModal
        open={!!deleteModal}
        title="Delete Course"
        message="Are you sure you want to delete this course? This will also remove all associated holes. Courses with existing bets cannot be deleted."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteModal(null)}
      />
    </div>
  )
}
