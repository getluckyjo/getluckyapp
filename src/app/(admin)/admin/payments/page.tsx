'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import StatusBadge from '@/components/admin/StatusBadge'
import SearchInput from '@/components/admin/SearchInput'
import Pagination from '@/components/admin/Pagination'
import { formatZAR, timeAgo } from '@/lib/format'
import type { AdminPaymentRecord, PaginatedResponse } from '@/types/admin'

const th: React.CSSProperties = { padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }
const td: React.CSSProperties = { padding: '12px 14px', color: '#333' }

const STATUS_VARIANT: Record<AdminPaymentRecord['status'], 'success' | 'warning' | 'danger'> = {
  complete: 'success',
  pending: 'warning',
  failed: 'danger',
  amount_mismatch: 'danger',
}

/**
 * The PayFast ledger: every payment the app has recorded, and the bet it
 * produced. "Needs attention" is the one that matters — a complete payment
 * with no bet means a golfer paid and has nothing to play, which no amount
 * of waiting fixes.
 */
export default function AdminPaymentsPage() {
  const router = useRouter()
  const [data, setData] = useState<AdminPaymentRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [unmatchedOnly, setUnmatchedOnly] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '20' })
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    if (unmatchedOnly) params.set('unmatched', 'true')
    return params.toString()
  }, [page, search, statusFilter, unmatchedOnly])
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null)
  const loading = loadedQuery !== query

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/payments?${query}`)
      .then(res => res.json() as Promise<PaginatedResponse<AdminPaymentRecord>>)
      .then(json => {
        if (cancelled) return
        setData(json.data || [])
        setTotal(json.total || 0)
        setTotalPages(json.totalPages || 1)
      })
      .catch(() => { if (!cancelled) setData([]) })
      .finally(() => { if (!cancelled) setLoadedQuery(query) })
    return () => { cancelled = true }
  }, [query])

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>Payments</h1>
        <p style={{ fontSize: 14, color: '#666' }}>Every payment PayFast has recorded, and the bet it produced</p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchInput
          placeholder="Search golfer or reference..."
          value={search}
          onChange={(v) => { setSearch(v); setPage(1) }}
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13, color: '#333', background: '#fff' }}
        >
          <option value="">All statuses</option>
          <option value="complete">Complete</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="amount_mismatch">Amount mismatch</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#333', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={unmatchedOnly}
            onChange={(e) => { setUnmatchedOnly(e.target.checked); setPage(1) }}
          />
          Paid, but no bet
        </label>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
              <th style={th}>Golfer</th>
              <th style={th}>Course / Hole</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th>
              <th style={{ ...th, textAlign: 'center' }}>Status</th>
              <th style={{ ...th, textAlign: 'center' }}>Paid with</th>
              <th style={{ ...th, textAlign: 'center' }}>Bet</th>
              <th style={{ ...th, textAlign: 'right' }}>Taken</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} style={{ padding: 14 }}>
                      <div style={{ height: 16, background: '#f0f0f0', borderRadius: 4, width: '70%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#999' }}>No payments found</td></tr>
            ) : (
              data.map(payment => {
                const needsAttention = payment.status === 'complete' && !payment.betId
                return (
                  <tr key={payment.mPaymentId} style={{ borderBottom: '1px solid #f0f0f0', background: needsAttention ? '#fffdf5' : undefined }}>
                    <td style={{ ...td, fontWeight: 500, color: '#111' }}>
                      {payment.userId ? (
                        <button
                          onClick={() => router.push(`/admin/users/${payment.userId}`)}
                          style={{ background: 'none', border: 'none', padding: 0, color: '#335231', fontWeight: 600, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                        >
                          {payment.userName || payment.userEmail || 'Unknown'}
                        </button>
                      ) : 'Unknown'}
                    </td>
                    <td style={{ ...td, color: '#666' }}>
                      {payment.courseName ? `${payment.courseName}${payment.holeNumber ? `, H${payment.holeNumber}` : ''}` : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: '#111' }}>{formatZAR(payment.amountCents)}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <StatusBadge status={payment.status} small variant={STATUS_VARIANT[payment.status]} />
                    </td>
                    <td style={{ ...td, textAlign: 'center', color: '#666', fontSize: 12 }}>
                      {payment.source === 'saved_card' ? 'Saved card' : 'Checkout'}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {payment.betId ? (
                        <button
                          onClick={() => router.push(`/admin/bets/${payment.betId}`)}
                          style={{ background: 'none', border: 'none', padding: 0, color: '#335231', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                        >
                          Open bet
                        </button>
                      ) : needsAttention ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#a07820', fontWeight: 600, fontSize: 12 }}>
                          <AlertTriangle size={13} /> None
                        </span>
                      ) : (
                        <span style={{ color: '#999' }}>—</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: '#999', fontSize: 12 }}>{timeAgo(payment.createdAt)}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
    </div>
  )
}
