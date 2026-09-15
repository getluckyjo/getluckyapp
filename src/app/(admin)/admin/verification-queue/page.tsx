'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, CheckCircle, XCircle, Clock } from 'lucide-react'
import StatusBadge from '@/components/admin/StatusBadge'
import Pagination from '@/components/admin/Pagination'
import ConfirmModal from '@/components/admin/ConfirmModal'
import { formatZAR, timeAgo } from '@/lib/format'
import type { VerificationQueueItem, PaginatedResponse, VerificationStatus } from '@/types/admin'
import { TIER_LABELS } from '@/lib/tiers'

const PIPELINE_STAGES: { status: VerificationStatus; label: string; color: string }[] = [
  { status: 'pending', label: 'Pending', color: '#f59e0b' },
  { status: 'documents_received', label: 'Docs Received', color: '#b8860b' },
  { status: 'under_review', label: 'Under Review', color: '#1565c0' },
  { status: 'approved', label: 'Approved', color: '#1a7f37' },
  { status: 'rejected', label: 'Rejected', color: '#c0392b' },
]

export default function VerificationQueuePage() {
  const router = useRouter()
  const [data, setData] = useState<VerificationQueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [sort, setSort] = useState('oldest')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchModal, setBatchModal] = useState<{ action: 'approve' | 'reject' | 'under_review' } | null>(null)
  const [batchNotes, setBatchNotes] = useState('')
  const [pipelineCounts, setPipelineCounts] = useState<Record<string, number>>({})

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), sort })
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/admin/verifications?${params}`)
      const json: PaginatedResponse<VerificationQueueItem> = await res.json()
      setData(json.data || [])
      setTotal(json.total || 0)
      setTotalPages(json.totalPages || 1)
    } catch (err) {
      console.error('[admin] request failed:', err)
      setData([])
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, sort])

  // Fetch pipeline counts (all statuses)
  const fetchPipelineCounts = useCallback(async () => {
    try {
      const counts: Record<string, number> = {}
      for (const stage of PIPELINE_STAGES) {
        const res = await fetch(`/api/admin/verifications?status=${stage.status}&limit=1`)
        const json = await res.json()
        counts[stage.status] = json.total || 0
      }
      setPipelineCounts(counts)
    } catch (err) {
      console.error('[admin] request failed:', err)
      // ignore
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { fetchPipelineCounts() }, [fetchPipelineCounts])

  const toggleSelect = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const toggleSelectAll = () => {
    if (selected.size === data.length) setSelected(new Set())
    else setSelected(new Set(data.map(d => d.id)))
  }

  const handleBatchAction = async () => {
    if (!batchModal) return
    try {
      await fetch('/api/admin/verifications/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), action: batchModal.action, notes: batchNotes }),
      })
      setSelected(new Set())
      setBatchModal(null)
      setBatchNotes('')
      fetchData()
      fetchPipelineCounts()
    } catch (err) {
      console.error('[admin] request failed:', err)
      // error handled silently
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>Verification Queue</h1>
        <p style={{ fontSize: 14, color: '#666' }}>Review and process hole-in-one claims</p>
      </div>

      {/* Pipeline visualization */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 24,
          background: '#fff',
          borderRadius: 12,
          border: '1px solid #e5e5e5',
          overflow: 'hidden',
        }}
      >
        {PIPELINE_STAGES.map((stage, i) => (
          <button
            key={stage.status}
            onClick={() => {
              setStatusFilter(statusFilter === stage.status ? '' : stage.status)
              setPage(1)
            }}
            style={{
              flex: 1,
              padding: '16px 12px',
              background: statusFilter === stage.status ? `${stage.color}10` : 'transparent',
              border: 'none',
              borderRight: i < PIPELINE_STAGES.length - 1 ? '1px solid #e5e5e5' : 'none',
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'background 0.15s',
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, color: stage.color }}>
              {pipelineCounts[stage.status] ?? '—'}
            </div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{stage.label}</div>
          </button>
        ))}
      </div>

      {/* Controls row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {statusFilter && (
            <button
              onClick={() => { setStatusFilter(''); setPage(1) }}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #e5e5e5',
                background: '#fff',
                fontSize: 13,
                cursor: 'pointer',
                color: '#666',
              }}
            >
              Clear filter
            </button>
          )}
        </div>

        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value); setPage(1) }}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #e5e5e5',
            fontSize: 13,
            color: '#333',
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
          <option value="highest">Highest value</option>
        </select>
      </div>

      {/* Batch actions bar */}
      {selected.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            background: '#335231',
            borderRadius: 8,
            marginBottom: 12,
            color: '#fff',
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 600 }}>{selected.size} selected</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setBatchModal({ action: 'under_review' })}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
              borderRadius: 6, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent',
              color: '#fff', fontSize: 13, cursor: 'pointer',
            }}
          >
            <Clock size={14} /> Mark Under Review
          </button>
          <button
            onClick={() => setBatchModal({ action: 'approve' })}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
              borderRadius: 6, border: 'none', background: '#1a7f37',
              color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600,
            }}
          >
            <CheckCircle size={14} /> Approve
          </button>
          <button
            onClick={() => setBatchModal({ action: 'reject' })}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
              borderRadius: 6, border: 'none', background: '#c0392b',
              color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600,
            }}
          >
            <XCircle size={14} /> Reject
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>
                <input
                  type="checkbox"
                  checked={selected.size === data.length && data.length > 0}
                  onChange={toggleSelectAll}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>User</th>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Course / Hole</th>
              <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Tier</th>
              <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Potential Win</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Status</th>
              <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Submitted</th>
              <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} style={{ padding: '14px' }}>
                      <div style={{ height: 16, background: '#f0f0f0', borderRadius: 4, width: '70%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#999' }}>
                  No claims to review
                </td>
              </tr>
            ) : (
              data.map((item) => (
                <tr
                  key={item.id}
                  className="admin-tr"
                  style={{
                    borderBottom: '1px solid #f0f0f0',
                    background: selected.has(item.id) ? '#f0f7ff' : undefined,
                    cursor: 'pointer',
                  }}
                  onClick={() => router.push(`/admin/verification-queue/${item.id}`)}
                >
                  <td
                    style={{ padding: '12px 14px' }}
                    onClick={(e) => { e.stopPropagation(); toggleSelect(item.id) }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ padding: '12px 14px', fontWeight: 500, color: '#111' }}>
                    {item.userName || 'Unknown'}
                  </td>
                  <td style={{ padding: '12px 14px', color: '#666' }}>
                    {item.courseName}, Hole {item.holeNumber}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{ fontSize: 12, color: '#335231', fontWeight: 600 }}>
                      {TIER_LABELS[item.tier] || item.tier}
                    </span>
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#111' }}>
                    {formatZAR(item.potentialWinCents)}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                    <StatusBadge status={item.status} small />
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', color: '#999', fontSize: 12 }}>
                    {timeAgo(item.createdAt)}
                  </td>
                  <td
                    style={{ padding: '12px 14px', textAlign: 'center' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => router.push(`/admin/verification-queue/${item.id}`)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '5px 12px',
                        borderRadius: 6,
                        border: '1px solid #e5e5e5',
                        background: '#fff',
                        fontSize: 12,
                        cursor: 'pointer',
                        color: '#335231',
                        fontWeight: 500,
                        margin: '0 auto',
                      }}
                    >
                      <Eye size={13} /> Review
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />

      {/* Batch confirm modal */}
      <ConfirmModal
        open={!!batchModal}
        title={
          batchModal?.action === 'approve' ? 'Approve Claims'
          : batchModal?.action === 'reject' ? 'Reject Claims'
          : 'Mark Under Review'
        }
        message={`This will ${batchModal?.action === 'approve' ? 'approve' : batchModal?.action === 'reject' ? 'reject' : 'mark as under review'} ${selected.size} claim(s). ${batchModal?.action === 'approve' ? 'Approved claims will move bets to verified status.' : ''}`}
        confirmLabel={batchModal?.action === 'approve' ? 'Approve All' : batchModal?.action === 'reject' ? 'Reject All' : 'Confirm'}
        variant={batchModal?.action === 'reject' ? 'danger' : 'success'}
        onConfirm={handleBatchAction}
        onCancel={() => { setBatchModal(null); setBatchNotes('') }}
      >
        <textarea
          value={batchNotes}
          onChange={(e) => setBatchNotes(e.target.value)}
          placeholder="Add reviewer notes (optional)..."
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 8,
            border: '1px solid #e5e5e5',
            fontSize: 13,
            resize: 'vertical',
            minHeight: 60,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        />
      </ConfirmModal>
    </div>
  )
}
