'use client'

import { useState, useEffect, useCallback } from 'react'
import { Download } from 'lucide-react'
import StatusBadge from '@/components/admin/StatusBadge'
import SearchInput from '@/components/admin/SearchInput'
import Pagination from '@/components/admin/Pagination'
import { formatZAR, timeAgo } from '@/lib/format'
import { TIER_LABELS } from '@/lib/tiers'
import type { AdminBetRecord, PaginatedResponse } from '@/types/admin'

export default function AdminBetsPage() {
  const [data, setData] = useState<AdminBetRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [tierFilter, setTierFilter] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      if (tierFilter) params.set('tier', tierFilter)
      const res = await fetch(`/api/admin/bets?${params}`)
      const json: PaginatedResponse<AdminBetRecord> = await res.json()
      setData(json.data || [])
      setTotal(json.total || 0)
      setTotalPages(json.totalPages || 1)
    } catch {
      setData([])
    } finally {
      setLoading(false)
    }
  }, [page, search, statusFilter, tierFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const handleExport = async () => {
    const res = await fetch('/api/admin/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'bets' }),
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bets-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>Bet Management</h1>
          <p style={{ fontSize: 14, color: '#666' }}>View and manage all bets on the platform</p>
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
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchInput
          placeholder="Search user, course, or bet ID..."
          value={search}
          onChange={(v) => { setSearch(v); setPage(1) }}
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, color: '#333', background: '#fff' }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="miss">Miss</option>
          <option value="claimed">Claimed</option>
          <option value="verified">Verified</option>
          <option value="paid">Paid</option>
        </select>
        <select
          value={tierFilter}
          onChange={(e) => { setTierFilter(e.target.value); setPage(1) }}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, color: '#333', background: '#fff' }}
        >
          <option value="">All tiers</option>
          <option value="tier_1">Tier 1 (R50)</option>
          <option value="tier_2">Tier 2 (R100)</option>
          <option value="tier_3">Tier 3 (R250)</option>
          <option value="tier_4">Tier 4 (R500)</option>
          <option value="tier_5">Tier 5 (R1,000)</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>User</th>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Course / Hole</th>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Tier</th>
              <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Stake</th>
              <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Potential Win</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Status</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Result</th>
              <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} style={{ padding: 14 }}>
                      <div style={{ height: 16, background: '#f0f0f0', borderRadius: 4, width: '70%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#999' }}>
                  No bets found
                </td>
              </tr>
            ) : (
              data.map((bet) => (
                <tr key={bet.id} className="admin-tr" style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 500, color: '#111' }}>
                    {bet.userName || 'Unknown'}
                  </td>
                  <td style={{ padding: '12px 14px', color: '#666' }}>
                    {bet.courseName}, H{bet.holeNumber}
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: 12, color: '#335231', fontWeight: 600 }}>
                    {TIER_LABELS[bet.tier]}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', color: '#111' }}>
                    {formatZAR(bet.stakeCents)}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#111' }}>
                    {formatZAR(bet.potentialWinCents)}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                    <StatusBadge status={bet.status} small />
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'center', color: '#666' }}>
                    {bet.declaredResult ? (
                      <StatusBadge status={bet.declaredResult === 'win' ? 'claimed' : 'miss'} small />
                    ) : '—'}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', color: '#999', fontSize: 12 }}>
                    {timeAgo(bet.createdAt)}
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
