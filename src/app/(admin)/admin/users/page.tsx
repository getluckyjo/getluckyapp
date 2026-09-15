'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Eye, Ban, Shield } from 'lucide-react'
import StatusBadge from '@/components/admin/StatusBadge'
import SearchInput from '@/components/admin/SearchInput'
import Pagination from '@/components/admin/Pagination'
import { formatZAR, timeAgo } from '@/lib/format'
import type { AdminUserRecord, PaginatedResponse } from '@/types/admin'

export default function AdminUsersPage() {
  const router = useRouter()
  const [data, setData] = useState<AdminUserRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [suspendedFilter, setSuspendedFilter] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('search', search)
      if (suspendedFilter) params.set('suspended', suspendedFilter)
      const res = await fetch(`/api/admin/users?${params}`)
      const json: PaginatedResponse<AdminUserRecord> = await res.json()
      setData(json.data || [])
      setTotal(json.total || 0)
      setTotalPages(json.totalPages || 1)
    } catch {
      setData([])
    } finally {
      setLoading(false)
    }
  }, [page, search, suspendedFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const handleExport = async () => {
    const res = await fetch('/api/admin/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'users' }),
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `users-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>User Management</h1>
          <p style={{ fontSize: 14, color: '#666' }}>View and manage all registered users</p>
        </div>
        <button
          onClick={handleExport}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            borderRadius: 8, border: '1px solid #e5e5e5', background: '#fff',
            fontSize: 13, cursor: 'pointer', color: '#333', fontWeight: 500,
          }}
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <SearchInput
          placeholder="Search by name or email..."
          value={search}
          onChange={(v) => { setSearch(v); setPage(1) }}
        />
        <select
          value={suspendedFilter}
          onChange={(e) => { setSuspendedFilter(e.target.value); setPage(1) }}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, color: '#333', background: '#fff' }}
        >
          <option value="">All users</option>
          <option value="false">Active</option>
          <option value="true">Suspended</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>User</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Handicap</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Attempts</th>
              <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Total Staked</th>
              <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Total Won</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Status</th>
              <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Joined</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} style={{ padding: 14 }}>
                      <div style={{ height: 16, background: '#f0f0f0', borderRadius: 4, width: '60%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#999' }}>No users found</td>
              </tr>
            ) : (
              data.map((user) => (
                <tr
                  key={user.id}
                  className="admin-tr"
                  style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                  onClick={() => router.push(`/admin/users/${user.id}`)}
                >
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 32, height: 32, borderRadius: '50%', background: '#335231',
                          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 13, fontWeight: 700, flexShrink: 0,
                        }}
                      >
                        {(user.name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, color: '#111', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {user.name || 'Unknown'}
                          {user.isAdmin && <Shield size={12} color="#335231" />}
                        </div>
                        <div style={{ fontSize: 12, color: '#999' }}>{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'center', color: '#666' }}>{user.handicap ?? '—'}</td>
                  <td style={{ padding: '12px 14px', textAlign: 'center', color: '#111', fontWeight: 500 }}>{user.totalAttempts}</td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', color: '#111' }}>{formatZAR(user.totalStaked)}</td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', color: user.totalWon > 0 ? '#1a7f37' : '#999', fontWeight: user.totalWon > 0 ? 600 : 400 }}>
                    {user.totalWon > 0 ? formatZAR(user.totalWon) : '—'}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                    {user.suspendedAt ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#c0392b', fontWeight: 600 }}>
                        <Ban size={12} /> Suspended
                      </span>
                    ) : (
                      <StatusBadge status="active" small />
                    )}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', color: '#999', fontSize: 12 }}>
                    {timeAgo(user.createdAt)}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => router.push(`/admin/users/${user.id}`)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
                        borderRadius: 6, border: '1px solid #e5e5e5', background: '#fff',
                        fontSize: 12, cursor: 'pointer', color: '#335231', fontWeight: 500, margin: '0 auto',
                      }}
                    >
                      <Eye size={13} /> View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
    </div>
  )
}
