'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { Download } from 'lucide-react'
import SearchInput from '@/components/admin/SearchInput'
import Pagination from '@/components/admin/Pagination'
import LoadError from '@/components/admin/LoadError'
import { formatZAR, timeAgo } from '@/lib/format'
import type { AdminUserRecord, PaginatedResponse } from '@/types/admin'
import { downloadExport, sastDate } from '../bets/client-helpers'

const OFFLINE = 'Could not reach the server. Check your connection and try again.'

/** "5m ago" for the last week (the same anywhere), then the date in South African time. */
const joined = (iso: string) => (Date.now() - new Date(iso).getTime() < 7 * 24 * 3_600_000 ? timeAgo(iso) : sastDate(iso))

export default function AdminUsersPage() {
  const [data, setData] = useState<AdminUserRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [suspendedFilter, setSuspendedFilter] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<{ error: boolean; text: string } | null>(null)

  const filters = useMemo(() => {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (suspendedFilter) params.set('suspended', suspendedFilter)
    return params
  }, [search, suspendedFilter])

  // Loading is derived: the page is loading until the query it currently
  // shows has been answered, so no state is set synchronously in an effect.
  const query = useMemo(() => {
    const params = new URLSearchParams(filters)
    params.set('page', String(page))
    params.set('limit', '20')
    return params.toString()
  }, [filters, page])
  const [refresh, setRefresh] = useState(0)
  const requestKey = `${query}#${refresh}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== requestKey

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/users?${query}`)
      .then(async res => {
        const json = await res.json().catch(() => ({})) as Partial<PaginatedResponse<AdminUserRecord>> & { error?: string }
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

  /** The CSV of the users the list shows: the same search and filter. */
  const handleExport = async () => {
    setExporting(true)
    setExportNote(null)
    const body: { type: string } & Record<string, unknown> = { type: 'users' }
    if (search) body.search = search
    if (suspendedFilter) body.suspended = suspendedFilter
    const result = await downloadExport(body)
    setExporting(false)
    if (!result.ok) setExportNote({ error: true, text: `The export failed. ${result.error}` })
    else if (result.cappedAt) setExportNote({ error: false, text: `The file holds the newest ${result.cappedAt.toLocaleString('en-ZA')} users only. Search or filter to export the rest.` })
    else setExportNote({ error: false, text: `Exported ${result.rows.toLocaleString('en-ZA')} user${result.rows === 1 ? '' : 's'}.` })
  }

  const filtered = Boolean(search || suspendedFilter)

  return (
    <div>
      <title>Users · Get Lucky admin</title>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">Users</h1>
          <p className="adm-lead">Everyone who has signed up. Open a golfer to see their bets, claims and payments, or to suspend them.</p>
        </div>
        <button type="button" onClick={handleExport} disabled={exporting} className="adm-btn adm-btn--quiet">
          <Download size={14} aria-hidden /> {exporting ? 'Exporting…' : filtered ? 'Export these as CSV' : 'Export CSV'}
        </button>
      </div>

      {exportNote && (
        <p role={exportNote.error ? 'alert' : 'status'} className={exportNote.error ? 'adm-error' : 'adm-small'} style={{ margin: '-12px 0 14px' }}>
          {exportNote.text}
        </p>
      )}

      <div className="adm-row" style={{ marginBottom: 16, alignItems: 'center' }}>
        <SearchInput
          placeholder="Search by name or email"
          value={search}
          onChange={(v) => { setSearch(v); setPage(1) }}
        />
        <select
          value={suspendedFilter}
          onChange={(e) => { setSuspendedFilter(e.target.value); setPage(1) }}
          aria-label="Show"
          className="adm-input"
        >
          <option value="">All users</option>
          <option value="false">Active</option>
          <option value="true">Suspended</option>
        </select>
      </div>

      {loadError && !loading ? (
        <LoadError what="The users" onRetry={() => setRefresh(n => n + 1)} detail={loadError} />
      ) : (
        <div className="adm-card">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th className="adm-num">Handicap</th>
                  <th className="adm-num">Attempts</th>
                  <th className="adm-num">Staked</th>
                  <th className="adm-num">Won</th>
                  <th>Status</th>
                  <th className="adm-num">Joined</th>
                </tr>
              </thead>
              <tbody>
                {loading && data.length === 0 ? (
                  <tr><td colSpan={7} className="adm-muted">Loading…</td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={7} className="adm-muted" style={{ padding: 28, textAlign: 'center' }}>
                    {filtered ? 'Nobody matches.' : 'Nobody has signed up yet.'}
                  </td></tr>
                ) : data.map((user) => (
                  <tr key={user.id} style={{ opacity: loading ? 0.6 : 1 }}>
                    <td>
                      <Link href={`/admin/users/${user.id}`} className="adm-row-link">{user.name || 'No name'}</Link>
                      {user.isAdmin && <span className="adm-pill adm-pill--gold" style={{ marginLeft: 8, padding: '1px 8px', fontSize: 11 }}>Admin</span>}
                      <div className="adm-small">{user.email}</div>
                    </td>
                    <td className="adm-num">{user.handicap ?? '—'}</td>
                    <td className="adm-num" style={{ fontWeight: 600 }}>{user.totalAttempts}</td>
                    <td className="adm-num">{formatZAR(user.totalStaked)}</td>
                    <td className="adm-num" style={{ fontWeight: user.totalWon > 0 ? 700 : 400 }}>
                      {user.totalWon > 0 ? formatZAR(user.totalWon) : <span className="adm-muted">—</span>}
                    </td>
                    <td>
                      {user.suspendedAt
                        ? <span className="adm-pill adm-pill--red">Suspended</span>
                        : <span className="adm-pill adm-pill--green">Active</span>}
                    </td>
                    <td className="adm-num adm-muted">{joined(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
        </div>
      )}
    </div>
  )
}
