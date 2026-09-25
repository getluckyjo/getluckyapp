'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import SearchInput from '@/components/admin/SearchInput'
import Pagination from '@/components/admin/Pagination'
import ConfirmModal from '@/components/admin/ConfirmModal'
import LoadError from '@/components/admin/LoadError'
import type { AdminCourseRecord, PaginatedResponse } from '@/types/admin'
import { OFFLINE } from './course-fields'

/** A course in the list, with its club officials counted (the API adds officialCount). */
type CourseListRecord = AdminCourseRecord & { officialCount: number }

/** The one filter box: partner status, or partner courses nobody can confirm a claim at. */
const FILTERS: Record<string, Record<string, string>> = {
  '': {},
  partners: { partner: 'true' },
  others: { partner: 'false' },
  'no-official': { officials: 'none' },
}

type Pending =
  | { kind: 'delete'; course: CourseListRecord }
  | { kind: 'partner'; course: CourseListRecord }

export default function AdminCoursesPage() {
  const [data, setData] = useState<CourseListRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Loading is derived: the page is loading until the query it currently
  // shows has been answered, so no state is set synchronously in an effect.
  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '20', ...FILTERS[filter] })
    if (search) params.set('search', search)
    return params.toString()
  }, [page, search, filter])
  const [refresh, setRefresh] = useState(0)
  const requestKey = `${query}#${refresh}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== requestKey
  const reload = () => setRefresh(n => n + 1)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/courses?${query}`)
      .then(async res => {
        const json = await res.json().catch(() => ({})) as Partial<PaginatedResponse<CourseListRecord>> & { error?: string }
        if (cancelled) return
        if (!res.ok) { setLoadError(json.error ?? `The server answered ${res.status}.`); return }
        setLoadError(null)
        setData(json.data ?? [])
        setTotal(json.total ?? 0)
        setTotalPages(json.totalPages || 1)
      })
      .catch(() => { if (!cancelled) setLoadError(OFFLINE) })
      .finally(() => { if (!cancelled) setLoadedKey(`${query}#${refresh}`) })
    return () => { cancelled = true }
  }, [query, refresh])

  function ask(p: Pending) {
    setActionError(null)
    setPending(p)
  }

  /** Runs the confirmed change; the modal stays open with the reason if it is refused. */
  async function confirmPending() {
    if (!pending) return
    const { course } = pending
    setBusy(true)
    setActionError(null)
    try {
      const res = pending.kind === 'delete'
        ? await fetch(`/api/admin/courses/${course.id}`, { method: 'DELETE' })
        : await fetch(`/api/admin/courses/${course.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_partner: !course.is_partner }),
        })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setActionError(json.error ?? 'That did not work. Please try again.'); return }
      setPending(null)
      reload()
    } catch {
      setActionError(OFFLINE)
    } finally {
      setBusy(false)
    }
  }

  const filtered = Boolean(search || filter)

  return (
    <div>
      <title>Courses · Get Lucky admin</title>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">Courses</h1>
          <p className="adm-lead">
            Golf courses, their par 3s and the club officials who confirm a claim. Golfers can pay to play only at partner courses.
          </p>
        </div>
        <Link href="/admin/courses/new" className="adm-btn" style={{ textDecoration: 'none' }}>
          <Plus size={18} aria-hidden /> Add course
        </Link>
      </div>

      <div className="adm-row" style={{ marginBottom: 16, alignItems: 'center' }}>
        <SearchInput
          placeholder="Search by name, region or town"
          value={search}
          onChange={(v) => { setSearch(v); setPage(1) }}
        />
        <select
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setPage(1) }}
          aria-label="Show"
          className="adm-input"
        >
          <option value="">All courses</option>
          <option value="partners">Partners</option>
          <option value="others">Not partners</option>
          <option value="no-official">Partners with no club official</option>
        </select>
      </div>

      {loadError && !loading ? (
        <LoadError what="The courses" onRetry={reload} detail={loadError} />
      ) : (
        <div className="adm-card">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Location</th>
                  <th>Partner</th>
                  <th className="adm-num">Holes on sale</th>
                  <th className="adm-num">Officials</th>
                  <th className="adm-num">Bets</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && data.length === 0 ? (
                  <tr><td colSpan={7} className="adm-muted">Loading…</td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={7} className="adm-muted" style={{ padding: 28, textAlign: 'center' }}>
                    {filtered ? 'No courses match.' : 'No courses yet. Add the first with Add course.'}
                  </td></tr>
                ) : data.map((course) => {
                  const noOfficial = course.is_partner && course.officialCount === 0
                  return (
                    <tr key={course.id} style={{ opacity: loading ? 0.6 : 1 }}>
                      <td><Link href={`/admin/courses/${course.id}`} className="adm-row-link">{course.name}</Link></td>
                      <td className="adm-muted">{course.location_text || course.region || '—'}</td>
                      <td>
                        <span className={course.is_partner ? 'adm-pill adm-pill--lime' : 'adm-pill'}>{course.is_partner ? 'Partner' : 'Not yet'}</span>
                      </td>
                      <td className="adm-num">{course.activeHoleCount} of {course.holeCount}</td>
                      <td className="adm-num">
                        {noOfficial
                          ? <span className="adm-pill adm-pill--red" title="A claim here has nobody to confirm the certificate">None</span>
                          : course.officialCount}
                      </td>
                      <td className="adm-num">{course.totalBets.toLocaleString('en-ZA')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                          <button type="button" onClick={() => ask({ kind: 'partner', course })} className="adm-btn adm-btn--quiet">
                            {course.is_partner ? 'End partnership' : 'Make partner'}
                          </button>
                          <button type="button" onClick={() => ask({ kind: 'delete', course })} className="adm-icon-btn adm-icon-btn--warn" aria-label={`Delete ${course.name}`} title="Delete">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
        </div>
      )}

      <ConfirmModal
        open={pending !== null}
        {...modalText(pending)}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
        busy={busy}
        error={actionError}
      >
        {pending?.kind === 'partner' && !pending.course.is_partner && pending.course.officialCount === 0 && (
          <p className="adm-warn" style={{ margin: 0 }}>
            It has no club official yet, so a claim here would have nobody to confirm the certificate. Add one on the course page first.
          </p>
        )}
      </ConfirmModal>
    </div>
  )
}

function modalText(p: Pending | null): { title: string; message: string; confirmLabel: string; variant: 'danger' | 'success' } {
  if (!p) return { title: '', message: '', confirmLabel: '', variant: 'danger' }
  const { course } = p
  if (p.kind === 'delete') {
    return {
      title: `Delete ${course.name}?`,
      message: 'Its holes and club officials go with it. A course with bets cannot be deleted; end the partnership instead.',
      confirmLabel: 'Delete course',
      variant: 'danger',
    }
  }
  return course.is_partner
    ? {
      title: `End the partnership with ${course.name}?`,
      message: 'Golfers can no longer pay to play here. Bets already made, and any claims, carry on as normal.',
      confirmLabel: 'End partnership',
      variant: 'danger',
    }
    : {
      title: `Make ${course.name} a partner?`,
      message: 'Golfers can then pay to play its par 3s that are on sale and 140 m or more.',
      confirmLabel: 'Make partner',
      variant: 'success',
    }
}
