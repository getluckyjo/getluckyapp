'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, Copy, Download, Undo2 } from 'lucide-react'
import StatusBadge from '@/components/admin/StatusBadge'
import ConfirmModal from '@/components/admin/ConfirmModal'
import SearchInput from '@/components/admin/SearchInput'
import Pagination from '@/components/admin/Pagination'
import LoadError from '@/components/admin/LoadError'
import { formatZAR, timeAgo } from '@/lib/format'
import type { AdminPaymentRecord, PaginatedResponse } from '@/types/admin'
import { downloadExport, getJson, sastDateTime } from '../bets/client-helpers'

const STATUS_VARIANT: Record<AdminPaymentRecord['status'], 'success' | 'warning' | 'danger'> = {
  complete: 'success',
  pending: 'warning',
  failed: 'danger',
  amount_mismatch: 'danger',
  unknown: 'warning',
}

const COLUMNS = 9

/** PayFast wants a reason of 3 to 255 characters. */
const MIN_REASON = 3
const MAX_REASON = 255

interface Loaded {
  key: string
  /** null when the request failed: never shown as "no payments". */
  list: PaginatedResponse<AdminPaymentRecord> | null
  /** What the server said when it failed. */
  detail?: string
}

/** Money was taken: complete, or complete for the wrong amount. */
const tookMoney = (p: AdminPaymentRecord) => p.status === 'complete' || p.status === 'amount_mismatch'
/** A refund can be asked for: money was taken, PayFast's id is known, and it has not been refunded. The server also checks the bet. */
const canRefund = (p: AdminPaymentRecord) => tookMoney(p) && !!p.pfPaymentId && !p.refundedAt

/**
 * The PayFast ledger: every payment the app has recorded, and the bet it
 * produced. "Paid, but no bet" is the one that matters: money taken and no
 * bet anywhere means a golfer paid and has nothing to play, which no amount
 * of waiting fixes. Both references are shown and copyable, to find the
 * payment in PayFast's dashboard.
 */
export default function AdminPaymentsPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [unmatchedOnly, setUnmatchedOnly] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [copied, setCopied] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<{ error: boolean; text: string } | null>(null)
  // The refund being asked about: the payment, the reason typed, and how the request went.
  const [refunding, setRefunding] = useState<AdminPaymentRecord | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [refundBusy, setRefundBusy] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)
  const [refundNote, setRefundNote] = useState<string | null>(null)

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '20' })
    if (search) params.set('search', search)
    if (unmatchedOnly) params.set('unmatched', 'true')
    else if (statusFilter) params.set('status', statusFilter)
    return params.toString()
  }, [page, search, statusFilter, unmatchedOnly])

  // Loading is derived from the request for what the page shows (and this
  // attempt at it), so an older answer cannot replace a newer one.
  const key = `${query}#${attempt}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const loading = loaded?.key !== key

  useEffect(() => {
    let cancelled = false
    getJson<PaginatedResponse<AdminPaymentRecord>>(`/api/admin/payments?${query}`)
      .then(list => { if (!cancelled) setLoaded({ key, list }) })
      .catch((err: unknown) => { if (!cancelled) setLoaded({ key, list: null, detail: err instanceof Error ? err.message : undefined }) })
    return () => { cancelled = true }
  }, [key, query])

  /** A new filter starts again from page 1, and an export note about the old one goes. */
  function filter(apply: () => void) {
    apply()
    setPage(1)
    setExportNote(null)
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      setTimeout(() => setCopied(c => (c === id ? null : c)), 1500)
    } catch { /* clipboard blocked; the reference is on screen to select by hand */ }
  }

  function openRefund(payment: AdminPaymentRecord) {
    setRefunding(payment)
    setRefundReason('')
    setRefundError(null)
    setRefundNote(null)
  }

  function closeRefund() {
    if (refundBusy) return
    setRefunding(null)
  }

  async function confirmRefund() {
    if (!refunding) return
    const reason = refundReason.trim()
    if (reason.length < MIN_REASON) return
    setRefundBusy(true)
    setRefundError(null)
    try {
      const res = await fetch(`/api/admin/payments/${encodeURIComponent(refunding.mPaymentId)}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string; requestId?: string }
      if (!res.ok) {
        const message = json.error ?? `The server answered ${res.status}.`
        setRefundError(json.requestId ? `${message} Reference ${json.requestId}.` : message)
        return
      }
      setRefundNote(`${formatZAR(refunding.amountCents)} is on its way back to ${refunding.userName || refunding.userEmail || 'the golfer'}. PayFast tells them.`)
      setRefunding(null)
      setAttempt(n => n + 1)
    } catch {
      setRefundError('The server could not be reached. Check your connection.')
    } finally {
      setRefundBusy(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    setExportNote(null)
    const body: { type: string } & Record<string, unknown> = { type: 'payments' }
    if (search) body.search = search
    if (unmatchedOnly) body.unmatched = true
    else if (statusFilter) body.status = statusFilter
    const result = await downloadExport(body)
    setExporting(false)
    if (!result.ok) setExportNote({ error: true, text: `The export failed. ${result.error}` })
    else if (result.cappedAt) setExportNote({ error: false, text: `The file holds the newest ${result.cappedAt.toLocaleString('en-ZA')} payments only. Narrow the filters to export the rest.` })
  }

  const list = loaded?.list ?? null
  const failed = !loading && loaded !== null && loaded.list === null
  const empty = unmatchedOnly && !search
    ? 'Every payment that took money has its bet. Nothing to chase.'
    : search || statusFilter || unmatchedOnly ? 'No payments match these filters.' : 'No payments yet.'

  return (
    <div>
      <title>Payments · Get Lucky admin</title>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">Payments</h1>
          <p className="adm-lead">
            Every payment PayFast has recorded, and the bet it produced. <strong>Paid, but no bet</strong> lists money taken
            (complete, or the wrong amount) with no bet anywhere: a golfer who paid and has nothing to play. The export follows the filters.
          </p>
        </div>
        <button type="button" onClick={handleExport} disabled={exporting} aria-busy={exporting} className="adm-btn adm-btn--quiet">
          <Download size={14} aria-hidden /> {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {exportNote && (
        <p role={exportNote.error ? 'alert' : 'status'} className={exportNote.error ? 'adm-error' : 'adm-warn'} style={{ margin: '0 0 14px' }}>
          {exportNote.text}
        </p>
      )}
      {refundNote && (
        <p role="status" className="adm-warn" style={{ margin: '0 0 14px' }}>{refundNote}</p>
      )}

      <div className="adm-row" style={{ marginBottom: 16 }}>
        <SearchInput
          placeholder="Search golfer, email or reference"
          value={search}
          onChange={v => filter(() => setSearch(v))}
        />
        <label className="adm-field">
          Status
          <select
            value={statusFilter}
            onChange={e => filter(() => setStatusFilter(e.target.value))}
            disabled={unmatchedOnly}
            title={unmatchedOnly ? 'Paid, but no bet covers complete and amount mismatch payments' : undefined}
            className="adm-input"
          >
            <option value="">All statuses</option>
            <option value="complete">Complete</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="unknown">Unknown (confirming)</option>
            <option value="amount_mismatch">Amount mismatch</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={unmatchedOnly}
            onChange={e => {
              const on = e.target.checked
              filter(() => { setUnmatchedOnly(on); if (on) setStatusFilter('') })
            }}
          />
          Paid, but no bet
        </label>
      </div>

      {failed ? (
        <LoadError what="The payments" detail={loaded?.detail} onRetry={() => setAttempt(n => n + 1)} />
      ) : (
        <div className="adm-card">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Golfer</th>
                  <th>Reference</th>
                  <th>Course / hole</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                  <th>Paid with</th>
                  <th style={{ textAlign: 'center' }}>Bet</th>
                  <th style={{ textAlign: 'right' }}>Taken (SA time)</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={COLUMNS} className="adm-muted" style={{ padding: 32, textAlign: 'center' }}>Loading payments…</td></tr>
                ) : !list || list.data.length === 0 ? (
                  <tr><td colSpan={COLUMNS} className="adm-muted" style={{ padding: 32, textAlign: 'center' }}>{empty}</td></tr>
                ) : (
                  list.data.map(payment => {
                    const needsAttention = tookMoney(payment) && !payment.betId
                    const pf = payment.pfPaymentId
                    return (
                      <tr key={payment.mPaymentId} style={needsAttention ? { background: '#fffbea' } : undefined}>
                        <td>
                          {payment.userId ? (
                            <Link href={`/admin/users/${payment.userId}`} className="adm-row-link">
                              {payment.userName || payment.userEmail || 'Unknown'}
                            </Link>
                          ) : <span className="adm-muted">Unknown</span>}
                          {payment.userName && payment.userEmail && <div className="adm-small">{payment.userEmail}</div>}
                        </td>
                        <td>
                          <Reference
                            value={payment.mPaymentId}
                            label="our reference"
                            copied={copied === `m:${payment.mPaymentId}`}
                            onCopy={() => copy(`m:${payment.mPaymentId}`, payment.mPaymentId)}
                          />
                          {pf && (
                            <Reference
                              value={pf}
                              label="the PayFast reference"
                              prefix="PayFast"
                              copied={copied === `pf:${payment.mPaymentId}`}
                              onCopy={() => copy(`pf:${payment.mPaymentId}`, pf)}
                            />
                          )}
                        </td>
                        <td className="adm-muted">
                          {payment.courseName ? `${payment.courseName}${payment.holeNumber ? `, H${payment.holeNumber}` : ''}` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatZAR(payment.amountCents)}</td>
                        <td style={{ textAlign: 'center' }}>
                          <StatusBadge status={payment.status} small variant={STATUS_VARIANT[payment.status]} />
                          {payment.refundedAt && (
                            <div className="adm-small" title={sastDateTime(payment.refundedAt)}>Refunded {timeAgo(payment.refundedAt)}</div>
                          )}
                        </td>
                        <td className="adm-small">{payment.source === 'saved_card' ? 'Saved card' : 'Checkout'}</td>
                        <td style={{ textAlign: 'center' }}>
                          {payment.betId ? (
                            <Link href={`/admin/bets/${payment.betId}`} className="adm-link">Open bet</Link>
                          ) : needsAttention ? (
                            <span className="adm-pill adm-pill--amber"><AlertTriangle size={12} aria-hidden /> None</span>
                          ) : (
                            <span className="adm-muted">—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <time dateTime={payment.createdAt}>{sastDateTime(payment.createdAt)}</time>
                          <div className="adm-small">{timeAgo(payment.createdAt)}</div>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {canRefund(payment) && (
                            <button type="button" onClick={() => openRefund(payment)} className="adm-btn adm-btn--quiet" style={{ minHeight: 32, padding: '0 10px' }}>
                              <Undo2 size={13} aria-hidden /> Refund
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {list && <Pagination page={page} totalPages={list.totalPages || 1} total={list.total} onPageChange={setPage} />}

      <ConfirmModal
        open={refunding !== null}
        title="Refund this payment"
        message={refunding
          ? `${formatZAR(refunding.amountCents)} goes back to ${refunding.userName || refunding.userEmail || 'the golfer'} through PayFast, to the card or account it came from. PayFast tells them. The bet is not changed; if it is still active, close it on the bet screen.`
          : ''}
        confirmLabel="Send the refund"
        busy={refundBusy}
        confirmDisabled={refundReason.trim().length < MIN_REASON}
        error={refundError}
        onConfirm={confirmRefund}
        onCancel={closeRefund}
      >
        <label className="adm-field">
          Reason (the golfer may see it)
          <textarea
            value={refundReason}
            onChange={e => setRefundReason(e.target.value.slice(0, MAX_REASON))}
            rows={3}
            maxLength={MAX_REASON}
            placeholder="e.g. Charged twice after a timeout"
            className="adm-input"
            disabled={refundBusy}
          />
        </label>
        <p className="adm-small" style={{ margin: '6px 0 0' }}>
          {refundReason.trim().length < MIN_REASON ? `At least ${MIN_REASON} characters.` : `${refundReason.length}/${MAX_REASON}`}
        </p>
      </ConfirmModal>
    </div>
  )
}

/** A payment reference in mono, with a button that copies it. */
function Reference({ value, label, prefix, copied, onCopy }: {
  value: string
  /** What is copied, for the button's name: "our reference". */
  label: string
  prefix?: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }} className={prefix ? 'adm-small' : undefined}>
      {prefix && <span>{prefix}</span>}
      <span className="adm-mono" style={prefix ? { fontSize: 12 } : undefined}>{value}</span>
      <button type="button" onClick={onCopy} aria-label={`Copy ${label}`} title={`Copy ${label}`} className="adm-icon-btn" style={{ width: 26, height: 26 }}>
        {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      </button>
    </div>
  )
}
