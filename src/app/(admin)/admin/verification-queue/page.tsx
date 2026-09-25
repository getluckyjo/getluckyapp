'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Clock, XCircle } from 'lucide-react'
import StatusBadge from '@/components/admin/StatusBadge'
import Pagination from '@/components/admin/Pagination'
import ConfirmModal from '@/components/admin/ConfirmModal'
import LoadError from '@/components/admin/LoadError'
import { formatZAR, timeAgo } from '@/lib/format'
import type { BatchActionResult, VerificationQueueItem, PaginatedResponse, VerificationStatus } from '@/types/admin'
import { TIER_LABELS } from '@/lib/tiers'
import { MIN_DECISION_NOTES } from '@/lib/claims/checklist'
import type { QueueStage } from '@/app/api/admin/verifications/review-types'
import { failureMessage, whenSA } from './helpers'

/** What the queue shows: a stage, one status, or everything. */
type Filter = QueueStage | VerificationStatus | 'all'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'open', label: 'Open claims' },
  { value: 'pending', label: 'Pending' },
  { value: 'documents_received', label: 'Documents received' },
  { value: 'under_review', label: 'Under review' },
  { value: 'awaiting_payout', label: 'Awaiting payout' },
  { value: 'approved', label: 'Approved (paid or not)' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All claims' },
]

/** The pipeline, in the order a claim moves through it. Paying out comes after approval. */
const PIPELINE: { filter: Filter; label: string }[] = [
  { filter: 'pending', label: 'Pending' },
  { filter: 'documents_received', label: 'Documents received' },
  { filter: 'under_review', label: 'Under review' },
  { filter: 'awaiting_payout', label: 'Awaiting payout' },
  { filter: 'approved', label: 'Approved' },
  { filter: 'rejected', label: 'Rejected' },
]

const EMPTY_TEXT: Partial<Record<Filter, string>> = {
  open: 'No claims are waiting for review.',
  awaiting_payout: 'No approved prizes are waiting to be paid.',
}

function filterParams(filter: Filter): Record<string, string> {
  if (filter === 'all') return {}
  if (filter === 'open' || filter === 'awaiting_payout') return { stage: filter }
  return { status: filter }
}

type ListState =
  | { query: string; ok: true; rows: VerificationQueueItem[]; total: number; totalPages: number }
  | { query: string; ok: false; message: string | null }

type BatchAction = 'reject' | 'under_review'

const NO_SELECTION: ReadonlySet<string> = new Set()

/** "3 rejected, 1 failed: Cannot move a verification from approved to rejected." */
function summarise(results: BatchActionResult[], verb: string): { text: string; failed: boolean } {
  const done = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success)
  if (failed.length === 0) return { text: `${done} ${verb}.`, failed: false }
  const reasons = new Map<string, number>()
  for (const r of failed) reasons.set(r.error ?? 'Processing failed', (reasons.get(r.error ?? 'Processing failed') ?? 0) + 1)
  const why = [...reasons].map(([reason, n]) => (n > 1 ? `${reason} (${n})` : reason)).join(' ')
  return { text: `${done} ${verb}, ${failed.length} failed: ${why}`, failed: true }
}

export default function VerificationQueuePage() {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<Filter>('open')
  const [sort, setSort] = useState('oldest')
  const [batchModal, setBatchModal] = useState<BatchAction | null>(null)
  const [batchNotes, setBatchNotes] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [batchSummary, setBatchSummary] = useState<{ text: string; failed: boolean } | null>(null)
  const [counts, setCounts] = useState<{ ok: true; values: Partial<Record<Filter, number>> } | { ok: false } | null>(null)

  // Loading is derived: the page is loading until the query it currently
  // shows has been answered, so no state is set synchronously in an effect.
  const query = useMemo(() => new URLSearchParams({ page: String(page), sort, ...filterParams(filter) }).toString(), [page, filter, sort])
  const [list, setList] = useState<ListState | null>(null)
  const loading = list?.query !== query
  // Bumped after a batch action or a retry, so both fetches re-run without changing the query.
  const [refresh, setRefresh] = useState(0)
  const reload = () => setRefresh(n => n + 1)

  // The selection belongs to the rows it was made on: a new page, filter or sort starts empty.
  const [selection, setSelection] = useState<{ query: string; ids: Set<string> }>({ query: '', ids: new Set() })
  const selected: ReadonlySet<string> = selection.query === query ? selection.ids : NO_SELECTION

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/verifications?${query}`)
      .then(async res => {
        const json = await res.json().catch(() => null) as (PaginatedResponse<VerificationQueueItem> & { error?: string }) | null
        if (cancelled) return
        if (!res.ok || !json) setList({ query, ok: false, message: failureMessage(res.status, json?.error) })
        else setList({ query, ok: true, rows: json.data ?? [], total: json.total ?? 0, totalPages: json.totalPages || 1 })
      })
      .catch(() => { if (!cancelled) setList({ query, ok: false, message: null }) })
    return () => { cancelled = true }
  }, [query, refresh])

  // Pipeline counts, one small request per stage in parallel. A failed count is "—", never 0.
  useEffect(() => {
    let cancelled = false
    Promise.all(PIPELINE.map(stage =>
      fetch(`/api/admin/verifications?${new URLSearchParams({ ...filterParams(stage.filter), limit: '1' })}`)
        .then(async res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const json = await res.json() as PaginatedResponse<unknown>
          return [stage.filter, json.total ?? 0] as const
        }),
    ))
      .then(totals => { if (!cancelled) setCounts({ ok: true, values: Object.fromEntries(totals) }) })
      .catch(err => {
        console.error('[admin] stage counts failed:', err)
        if (!cancelled) setCounts({ ok: false })
      })
    return () => { cancelled = true }
  }, [refresh])

  const rows = list?.ok ? list.rows : []

  const changeFilter = (next: Filter) => { setFilter(next); setPage(1); setBatchSummary(null) }

  const toggleSelect = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelection({ query, ids: next })
  }

  const toggleSelectAll = () => {
    setSelection({ query, ids: selected.size === rows.length ? new Set() : new Set(rows.map(d => d.id)) })
  }

  const closeBatch = () => { setBatchModal(null); setBatchNotes(''); setBatchError(null) }

  const runBatch = async () => {
    if (!batchModal) return
    const notes = batchNotes.trim()
    if (batchModal === 'reject' && notes.length < MIN_DECISION_NOTES) {
      setBatchError(`Give the reason, in at least ${MIN_DECISION_NOTES} characters.`)
      return
    }
    setBatchBusy(true)
    setBatchError(null)
    try {
      const res = await fetch('/api/admin/verifications/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), action: batchModal, ...(batchModal === 'reject' ? { notes } : {}) }),
      })
      const json = await res.json().catch(() => null) as { results?: BatchActionResult[]; error?: string } | null
      if (!res.ok || !json?.results) {
        setBatchError(failureMessage(res.status, json?.error) ?? 'Nothing was changed. Try again.')
        return
      }
      setBatchSummary(summarise(json.results, batchModal === 'reject' ? 'rejected' : 'marked under review'))
      setSelection({ query, ids: new Set() })
      closeBatch()
      reload()
    } catch (err) {
      console.error('[admin] batch request failed:', err)
      setBatchError('The request did not complete. Close this and check the queue to see what changed.')
    } finally {
      setBatchBusy(false)
    }
  }

  const rejectNotesShort = batchModal === 'reject' && batchNotes.trim().length < MIN_DECISION_NOTES

  return (
    <div>
      <title>Verification queue · Get Lucky admin</title>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">Verification queue</h1>
          <p className="adm-lead">
            Hole-in-one claims to review, and approved prizes to pay. Each claim is approved on its own page, with its checklist.
          </p>
        </div>
      </div>

      {/* The pipeline: each stage is a filter. */}
      <div className="adm-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 10 }}>
        {PIPELINE.map(stage => {
          const on = filter === stage.filter
          const value = counts?.ok ? counts.values[stage.filter] : undefined
          return (
            <button
              key={stage.filter}
              type="button"
              aria-pressed={on}
              onClick={() => changeFilter(on ? 'open' : stage.filter)}
              style={{
                flex: '1 1 120px', padding: '12px 10px', border: 'none', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                background: on ? 'var(--lime)' : 'transparent', color: 'var(--green)',
              }}
            >
              <div className="adm-stat-value" style={stage.filter === 'awaiting_payout' && value ? { color: 'var(--red)' } : undefined}>
                {value ?? '—'}
              </div>
              <div className="adm-stat-label">{stage.label}</div>
            </button>
          )
        })}
      </div>
      {counts && !counts.ok && (
        <p className="adm-error" role="alert" style={{ margin: '8px 0 0' }}>
          The stage counts could not be loaded. <button type="button" className="adm-link" onClick={reload}>Try again</button>
        </p>
      )}

      {/* Filter and sort */}
      <div className="adm-row" style={{ margin: '18px 0 12px', justifyContent: 'space-between' }}>
        <label className="adm-field">
          Show
          <select value={filter} onChange={e => changeFilter(e.target.value as Filter)} className="adm-input" style={{ minWidth: 220 }}>
            {FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
        <label className="adm-field">
          Sort
          <select value={sort} onChange={e => { setSort(e.target.value); setPage(1) }} className="adm-input">
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="highest">Highest prize</option>
            <option value="risk">Highest risk score</option>
          </select>
        </label>
      </div>

      {batchSummary && (
        <div role="status" className="adm-card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, border: batchSummary.failed ? '2px solid #f3d08a' : undefined }}>
          <span className={batchSummary.failed ? 'adm-warn' : undefined} style={{ flex: 1, fontSize: 13 }}>{batchSummary.text}</span>
          <button type="button" className="adm-link" onClick={() => setBatchSummary(null)}>Dismiss</button>
        </div>
      )}

      {/* Batch actions. Never approve: that goes through each claim's checklist. */}
      {selected.size > 0 && (
        <div className="adm-card adm-card--form" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>{selected.size} selected</strong>
          <button type="button" className="adm-link" onClick={() => setSelection({ query, ids: new Set() })}>Clear</button>
          <span className="adm-small" style={{ flex: '1 1 200px' }}>To approve, open each claim.</span>
          <button type="button" onClick={() => setBatchModal('under_review')} className="adm-btn adm-btn--quiet">
            <Clock size={14} aria-hidden /> Mark under review
          </button>
          <button type="button" onClick={() => setBatchModal('reject')} className="adm-btn adm-btn--quiet adm-btn--danger">
            <XCircle size={14} aria-hidden /> Reject
          </button>
        </div>
      )}

      {list && !list.ok && !loading ? (
        <LoadError what="The claims" onRetry={() => { setList(null); reload() }} detail={list.message} />
      ) : (
        <div className="adm-card" style={{ padding: '8px 12px' }}>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="Select every claim on this page"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={toggleSelectAll}
                      disabled={loading || rows.length === 0}
                    />
                  </th>
                  <th>Player</th>
                  <th>Course / hole</th>
                  <th>Tier</th>
                  <th className="adm-num">Prize</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'center' }}>Flags</th>
                  <th className="adm-num">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="adm-muted" style={{ padding: 28, textAlign: 'center' }}>Loading the claims…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="adm-muted" style={{ padding: 36, textAlign: 'center' }}>{EMPTY_TEXT[filter] ?? 'No claims here.'}</td></tr>
                ) : rows.map(item => {
                  const href = `/admin/verification-queue/${item.id}`
                  const name = item.userName || 'Unnamed player'
                  return (
                    <tr
                      key={item.id}
                      // A high risk score stands out; the reviewer still decides on the claim's own page.
                      className={`adm-tr-link${item.riskScore >= 6 ? ' adm-attention' : ''}`}
                      style={selected.has(item.id) ? { background: 'var(--surface)' } : undefined}
                      onClick={e => {
                        // The link, the checkbox and a modifier-click do their own thing.
                        if ((e.target as HTMLElement).closest('a, input, label, button') || e.metaKey || e.ctrlKey) return
                        router.push(href)
                      }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${name}'s claim`}
                          checked={selected.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                        />
                      </td>
                      <td><Link href={href} className="adm-row-link">{name}</Link></td>
                      <td className="adm-muted">{item.courseName || '—'}, hole {item.holeNumber || '?'}</td>
                      <td>{TIER_LABELS[item.tier] || item.tier}</td>
                      <td className="adm-num" style={{ fontWeight: 700 }}>{formatZAR(item.potentialWinCents)}</td>
                      <td>
                        {/* The bet's paid stamp lands on the verification, so an approved claim can say whether it is paid. */}
                        {item.status === 'approved' && item.payoutInitiatedAt
                          ? <StatusBadge status="paid" small />
                          : item.status === 'approved' && filter === 'awaiting_payout'
                          ? <StatusBadge status="awaiting_payout" variant="warning" small />
                          : <StatusBadge status={item.status} small />}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {item.riskFlagCount > 0 ? (
                          <span
                            title={`Risk score ${item.riskScore}`}
                            className={`adm-pill ${item.riskScore >= 6 ? 'adm-pill--red' : item.riskScore >= 3 ? 'adm-pill--amber' : ''}`}
                          >
                            {item.riskFlagCount}
                          </span>
                        ) : <span className="adm-muted">—</span>}
                      </td>
                      <td className="adm-num adm-muted" title={whenSA(item.createdAt)}>{timeAgo(item.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {list?.ok && <Pagination page={page} totalPages={list.totalPages} total={list.total} onPageChange={setPage} />}

      <ConfirmModal
        open={batchModal !== null}
        title={batchModal === 'reject' ? `Reject ${selected.size} claim${selected.size === 1 ? '' : 's'}` : 'Mark under review'}
        message={batchModal === 'reject'
          ? 'No prize is paid on a rejected claim, and a rejection cannot be undone. The reason is kept on every claim in the audit trail.'
          : `This tells other reviewers ${selected.size === 1 ? 'this claim is' : `these ${selected.size} claims are`} being looked at. Nothing is decided.`}
        confirmLabel={batchModal === 'reject' ? 'Reject' : 'Mark under review'}
        variant={batchModal === 'reject' ? 'danger' : 'success'}
        onConfirm={runBatch}
        onCancel={closeBatch}
        busy={batchBusy}
        confirmDisabled={rejectNotesShort}
        error={batchError}
      >
        {batchModal === 'reject' && (
          <label className="adm-field">
            Reason (required)
            <textarea
              value={batchNotes}
              onChange={e => setBatchNotes(e.target.value)}
              rows={3}
              className="adm-input"
              placeholder="Why these claims are rejected"
              required
              aria-describedby="batch-notes-hint"
            />
            <span id="batch-notes-hint" className="adm-hint">
              At least {MIN_DECISION_NOTES} characters{rejectNotesShort ? ` (${batchNotes.trim().length} so far)` : ''}.
            </span>
          </label>
        )}
      </ConfirmModal>
    </div>
  )
}
