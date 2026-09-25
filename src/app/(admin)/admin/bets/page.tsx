'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download } from 'lucide-react'
import StatusBadge from '@/components/admin/StatusBadge'
import SearchInput from '@/components/admin/SearchInput'
import Pagination from '@/components/admin/Pagination'
import LoadError from '@/components/admin/LoadError'
import { formatZAR, timeAgo } from '@/lib/format'
import { ALL_TIERS, TIER_LABELS } from '@/lib/tiers'
import type { AdminBetRecord, PaginatedResponse } from '@/types/admin'
import { downloadExport, getJson, sastDateTime } from './client-helpers'

const COLUMNS = 8

interface Loaded {
  key: string
  /** null when the request failed: never shown as "no bets". */
  list: PaginatedResponse<AdminBetRecord> | null
  /** What the server said when it failed. */
  detail?: string
}

/** Every bet on the platform, newest first. Filters run in the query, so the count, the pages and the export agree. */
export default function AdminBetsPage() {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<{ error: boolean; text: string } | null>(null)

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '20' })
    if (search) params.set('search', search)
    if (statusFilter) params.set('status', statusFilter)
    if (tierFilter) params.set('tier', tierFilter)
    return params.toString()
  }, [page, search, statusFilter, tierFilter])

  // Loading is derived: the page is loading until the request for what it
  // shows (and this attempt at it) has been answered. No state is set
  // synchronously in the effect, and an older answer cannot replace a newer one.
  const key = `${query}#${attempt}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const loading = loaded?.key !== key

  useEffect(() => {
    let cancelled = false
    getJson<PaginatedResponse<AdminBetRecord>>(`/api/admin/bets?${query}`)
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

  async function handleExport() {
    setExporting(true)
    setExportNote(null)
    const body: { type: string } & Record<string, unknown> = { type: 'bets' }
    if (search) body.search = search
    if (statusFilter) body.status = statusFilter
    if (tierFilter) body.tier = tierFilter
    const result = await downloadExport(body)
    setExporting(false)
    if (!result.ok) setExportNote({ error: true, text: `The export failed. ${result.error}` })
    else if (result.cappedAt) setExportNote({ error: false, text: `The file holds the newest ${result.cappedAt.toLocaleString('en-ZA')} bets only. Narrow the filters to export the rest.` })
  }

  const list = loaded?.list ?? null
  const failed = !loading && loaded !== null && loaded.list === null
  const filtered = Boolean(search || statusFilter || tierFilter)

  return (
    <div>
      <title>Bets · Get Lucky admin</title>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">Bets</h1>
          <p className="adm-lead">Every bet on the platform, newest first. Open one for its payment, footage and history. The export follows the filters.</p>
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

      <div className="adm-row" style={{ marginBottom: 16 }}>
        <SearchInput
          placeholder="Search player, email, course or bet ID"
          value={search}
          onChange={v => filter(() => setSearch(v))}
        />
        <label className="adm-field">
          Status
          <select value={statusFilter} onChange={e => filter(() => setStatusFilter(e.target.value))} className="adm-input">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="miss">Miss</option>
            <option value="claimed">Claimed</option>
            <option value="verified">Verified</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        <label className="adm-field">
          Tier
          <select value={tierFilter} onChange={e => filter(() => setTierFilter(e.target.value))} className="adm-input">
            <option value="">All tiers</option>
            {/* From the tier table, never a hand-kept copy: a hardcoded list
                had been missing tier_6 since the day it was added. */}
            {ALL_TIERS.map(t => (
              <option key={t.tier} value={t.tier}>{TIER_LABELS[t.tier]}</option>
            ))}
          </select>
        </label>
      </div>

      {failed ? (
        <LoadError what="The bets" detail={loaded?.detail} onRetry={() => setAttempt(n => n + 1)} />
      ) : (
        <div className="adm-card">
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Course / hole</th>
                  <th>Tier</th>
                  <th style={{ textAlign: 'right' }}>Stake</th>
                  <th style={{ textAlign: 'right' }}>Potential win</th>
                  <th style={{ textAlign: 'center' }}>Status</th>
                  <th style={{ textAlign: 'center' }}>Result</th>
                  <th style={{ textAlign: 'right' }}>Placed</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={COLUMNS} className="adm-muted" style={{ padding: 32, textAlign: 'center' }}>Loading bets…</td></tr>
                ) : !list || list.data.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS} className="adm-muted" style={{ padding: 32, textAlign: 'center' }}>
                      {filtered ? 'No bets match these filters.' : 'No bets yet.'}
                    </td>
                  </tr>
                ) : (
                  list.data.map(bet => (
                    // The row opens the bet on a click; the link in the first
                    // cell is the way in for a keyboard or a new tab.
                    <tr key={bet.id} className="admin-tr" style={{ cursor: 'pointer' }} onClick={() => router.push(`/admin/bets/${bet.id}`)}>
                      <td>
                        <Link
                          href={`/admin/bets/${bet.id}`}
                          className="adm-row-link"
                          aria-label={`${bet.userName || 'Unknown player'}: bet on ${bet.courseName}, hole ${bet.holeNumber}`}
                          onClick={e => e.stopPropagation()}
                        >
                          {bet.userName || 'Unknown'}
                        </Link>
                      </td>
                      <td className="adm-muted">{bet.courseName}, H{bet.holeNumber}</td>
                      <td style={{ fontWeight: 700 }}>{TIER_LABELS[bet.tier]}</td>
                      <td style={{ textAlign: 'right' }}>{formatZAR(bet.stakeCents)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatZAR(bet.potentialWinCents)}</td>
                      <td style={{ textAlign: 'center' }}><StatusBadge status={bet.status} small /></td>
                      <td style={{ textAlign: 'center' }}>
                        {bet.declaredResult ? <StatusBadge status={bet.declaredResult === 'win' ? 'claimed' : 'miss'} small /> : <span className="adm-muted">—</span>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} className="adm-small">
                        <time dateTime={bet.createdAt} title={sastDateTime(bet.createdAt)}>{timeAgo(bet.createdAt)}</time>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {list && <Pagination page={page} totalPages={list.totalPages || 1} total={list.total} onPageChange={setPage} />}
    </div>
  )
}
