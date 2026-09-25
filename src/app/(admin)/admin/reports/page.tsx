'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Banknote, TrendingUp, Trophy, HandCoins, Download, Gift } from 'lucide-react'
import StatCard from '@/components/admin/StatCard'
import Pagination from '@/components/admin/Pagination'
import LoadError from '@/components/admin/LoadError'
import { formatZAR } from '@/lib/format'
import type { AdminBetRecord } from '@/types/admin'
import { downloadExport, sastDate } from '@/app/(admin)/admin/bets/client-helpers'

/** /api/admin/reports/revenue. Revenue is the sum of stakes; netProfit is stakes minus prizes paid. */
interface RevenueData {
  totalRevenue: number
  totalPayouts: number
  netProfit: number
  margin: string
  /** Verified, not yet paid; null before migration 032. */
  prizesOwed: number | null
  totalBets: number
  byTier: { tier: string; label: string; count: number; revenue: number; payouts: number }[]
  byCourse: { name: string; revenue: number; count: number }[]
}

/** /api/admin/reports/free-swings — is the free swing paying for itself? */
interface FreeSwingData {
  taken: number
  taken7d: number
  taken30d: number
  matured: number
  pending: number
  converted7d: number
  conversionRate7d: string | null
  convertedEver: number
  conversionRateEver: string | null
  paidBetsAfterFree: number
  revenueAfterFreeCents: number
  revenuePerFreeSwingCents: number
  medianHoursToFirstPaid: number | null
  claimed: number
  prizeExposureCents: number
  weeks: { weekStart: string; taken: number; matured: number; converted: number; rate: string | null }[]
}

type PayoutKind = 'owed' | 'paid'

/** /api/admin/reports/payouts: one page of prizes owed or paid. */
interface PayoutPage {
  kind: PayoutKind
  data: (AdminBetRecord & { verifiedAt: string | null; paidAt: string | null; payoutReference: string | null })[]
  total: number
  totalPages: number
}

type Tab = 'revenue' | 'payouts' | 'free'
const TABS: { key: Tab; label: string }[] = [
  { key: 'revenue', label: 'Stakes' },
  { key: 'payouts', label: 'Prizes' },
  { key: 'free', label: 'Free swings' },
]

/** Courses shown before "Show all". */
const TOP_COURSES = 10
const showDate = (iso: string | null) => (iso ? sastDate(iso) : '—')
const money = (cents: number | null | undefined) => (cents == null ? '—' : formatZAR(cents))

/**
 * GET a report while `url` is set. A cancel flag keeps a slow answer for an
 * earlier url (the page before) from landing on top of a newer one, and
 * loading is derived: the answer held is for a different request. The last
 * answer stays in `data` while the next loads, so a page change dims the
 * table rather than blanking it.
 */
function useReport<T>(url: string | null) {
  const [attempt, setAttempt] = useState(0)
  const key = url ? `${attempt} ${url}` : null
  const [answer, setAnswer] = useState<{ key: string; data: T | null; detail: string | null } | null>(null)

  useEffect(() => {
    if (!url || !key) return
    let cancelled = false
    fetch(url, { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (!cancelled) setAnswer(res.ok && json ? { key, data: json as T, detail: null } : { key, data: null, detail: json?.error ?? null })
      })
      .catch(() => { if (!cancelled) setAnswer({ key, data: null, detail: null }) })
    return () => { cancelled = true }
  }, [url, key])

  const current = key !== null && answer?.key === key
  return {
    data: answer?.data ?? null,
    loading: key !== null && !current,
    failed: current && answer.data === null,
    detail: current ? answer.detail : null,
    retry: () => setAttempt(n => n + 1),
  }
}

/** A stat card in its own box: admin.css spaces a card that follows another (.adm-card + .adm-card), which in a row would push all but the first down. */
function Tile(props: React.ComponentProps<typeof StatCard>) {
  return <div style={{ flex: '1 1 210px', display: 'flex', minWidth: 0 }}><StatCard {...props} /></div>
}

export default function AdminReportsPage() {
  const [tab, setTab] = useState<Tab>('revenue')
  // Each tab's report is fetched the first time the tab opens, and kept.
  const [opened, setOpened] = useState<Record<Tab, boolean>>({ revenue: true, payouts: false, free: false })
  const [kind, setKind] = useState<PayoutKind>('owed')
  const [payoutPage, setPayoutPage] = useState(1)
  const [allCourses, setAllCourses] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  const [exportNote, setExportNote] = useState<{ error: boolean; text: string } | null>(null)
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})

  const revenue = useReport<RevenueData>('/api/admin/reports/revenue')
  const payouts = useReport<PayoutPage>(opened.payouts ? `/api/admin/reports/payouts?kind=${kind}&page=${payoutPage}` : null)
  const free = useReport<FreeSwingData>(opened.free ? '/api/admin/reports/free-swings' : null)

  function open(next: Tab) {
    setTab(next)
    setOpened(o => (o[next] ? o : { ...o, [next]: true }))
  }

  /** Arrow keys move between the tabs, as a tab list does. */
  function onTabKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = TABS.findIndex(t => t.key === tab)
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].key
    open(next)
    tabRefs.current[next]?.focus()
  }

  function showKind(next: PayoutKind) {
    setKind(next)
    setPayoutPage(1)
  }

  async function handleExport(type: 'bets' | 'verifications') {
    setExportNote(null)
    setExporting(type)
    const result = await downloadExport({ type })
    setExporting(null)
    const what = type === 'bets' ? 'bets' : 'claims'
    if (!result.ok) setExportNote({ error: true, text: `The export failed. ${result.error}` })
    else if (result.cappedAt) setExportNote({ error: false, text: `The file holds the newest ${result.cappedAt.toLocaleString('en-ZA')} ${what} only.` })
  }

  const rev = revenue.failed ? null : revenue.data
  // Rows of the other list (owed or paid) are never shown under this one's heading.
  const payoutData = payouts.data?.kind === kind && !payouts.failed ? payouts.data : null
  const courses = rev?.byCourse ?? []
  const shownCourses = allCourses ? courses : courses.slice(0, TOP_COURSES)

  return (
    <div>
      <title>Reports · Get Lucky admin</title>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">Reports</h1>
          <p className="adm-lead">What golfers have staked, the prizes owed and paid, and whether the free swing brings golfers back.</p>
        </div>
        <div className="adm-row" style={{ alignItems: 'center' }}>
          <button type="button" onClick={() => handleExport('bets')} disabled={exporting !== null} className="adm-btn adm-btn--quiet">
            <Download size={14} aria-hidden /> {exporting === 'bets' ? 'Preparing…' : 'Download bets'}
          </button>
          <button type="button" onClick={() => handleExport('verifications')} disabled={exporting !== null} className="adm-btn adm-btn--quiet">
            <Download size={14} aria-hidden /> {exporting === 'verifications' ? 'Preparing…' : 'Download claims'}
          </button>
        </div>
      </div>
      {exportNote && <p role={exportNote.error ? 'alert' : 'status'} className={exportNote.error ? 'adm-error' : 'adm-small'} style={{ margin: '-12px 0 16px' }}>{exportNote.text}</p>}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }} aria-busy={revenue.loading}>
        <Tile title="Stakes taken" value={money(rev?.totalRevenue)} icon={Banknote} subtitle={rev ? `${rev.totalBets.toLocaleString('en-ZA')} entries, free swings included` : undefined} />
        <Tile title="Prizes paid" value={money(rev?.totalPayouts)} icon={Trophy} />
        <Tile
          title="Stakes minus prizes paid"
          value={money(rev?.netProfit)}
          icon={TrendingUp}
          subtitle={rev ? `${rev.margin}% of stakes${rev.prizesOwed ? ', before the prizes owed' : ''}` : undefined}
        />
        {rev?.prizesOwed != null && (
          <Tile title="Prizes owed" value={money(rev.prizesOwed)} icon={HandCoins} subtitle="Verified, not yet paid" />
        )}
      </div>

      <div role="tablist" aria-label="Reports" onKeyDown={onTabKey} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            ref={el => { tabRefs.current[t.key] = el }}
            type="button"
            role="tab"
            id={`report-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`report-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => open(t.key)}
            className={tab === t.key ? 'adm-btn adm-btn--green' : 'adm-btn adm-btn--quiet'}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'revenue' && (
        <div role="tabpanel" id="report-panel-revenue" aria-labelledby="report-tab-revenue">
          {revenue.failed ? (
            <LoadError what="The stakes report" onRetry={revenue.retry} detail={revenue.detail} />
          ) : !rev ? (
            <p className="adm-muted">Loading…</p>
          ) : (
            <div className="adm-grid-2">
              <section className="adm-card" style={{ marginTop: 0 }}>
                <h2 className="adm-h2" style={{ marginBottom: 14 }}>Stakes by tier</h2>
                <Bars rows={rev.byTier.map(t => ({ key: t.tier, label: t.label, cents: t.revenue, count: t.count }))} />
              </section>
              <section className="adm-card" style={{ marginTop: 0 }}>
                <h2 className="adm-h2" style={{ marginBottom: 4 }}>Stakes by course</h2>
                <p className="adm-small" style={{ margin: '0 0 14px' }}>
                  {courses.length > TOP_COURSES && !allCourses
                    ? `The top ${TOP_COURSES} of ${courses.length} courses with stakes.`
                    : `All ${courses.length} ${courses.length === 1 ? 'course' : 'courses'} with stakes.`}
                </p>
                {courses.length === 0 ? (
                  <p className="adm-muted" style={{ margin: 0 }}>No stakes yet.</p>
                ) : (
                  <Bars rows={shownCourses.map((c, i) => ({ key: `${i}-${c.name}`, label: `${i + 1}. ${c.name}`, cents: c.revenue, count: c.count }))} />
                )}
                {courses.length > TOP_COURSES && (
                  <button type="button" onClick={() => setAllCourses(v => !v)} className="adm-link" style={{ marginTop: 14, fontSize: 13 }}>
                    {allCourses ? `Show the top ${TOP_COURSES}` : `Show all ${courses.length} courses`}
                  </button>
                )}
              </section>
            </div>
          )}
        </div>
      )}

      {tab === 'payouts' && (
        <div role="tabpanel" id="report-panel-payouts" aria-labelledby="report-tab-payouts">
          <div className="adm-row" style={{ alignItems: 'center', marginBottom: 12 }}>
            {(['owed', 'paid'] as const).map(k => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => showKind(k)} className={kind === k ? 'adm-btn adm-btn--green' : 'adm-btn adm-btn--quiet'}>
                {k === 'owed' ? 'Owed' : 'Paid'}
              </button>
            ))}
            <span className="adm-small">
              {kind === 'owed'
                ? 'Verified prizes not yet paid, the longest waiting first. Open one to record its payout.'
                : 'Prizes recorded as paid, the latest first, with the bank or PayFast reference.'}
            </span>
          </div>

          {payouts.failed ? (
            <LoadError what={kind === 'owed' ? 'The prizes owed' : 'The prizes paid'} onRetry={payouts.retry} detail={payouts.detail} />
          ) : !payoutData ? (
            <p className="adm-muted">Loading…</p>
          ) : (
            <>
              <div className="adm-card adm-table-wrap" aria-busy={payouts.loading} style={{ padding: '8px 12px', opacity: payouts.loading ? 0.55 : 1, transition: 'opacity 0.15s' }}>
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Golfer</th>
                      <th>Course</th>
                      <th className="adm-num">Prize</th>
                      {kind === 'owed' ? <><th>Verified</th><th>Payout</th></> : <><th>Paid</th><th>Reference</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {payoutData.data.length === 0 ? (
                      <tr><td colSpan={5} className="adm-muted" style={{ padding: 28, textAlign: 'center' }}>{kind === 'owed' ? 'No prizes owed.' : 'No prizes paid yet.'}</td></tr>
                    ) : payoutData.data.map(p => (
                      <tr key={p.id}>
                        <td><Link href={`/admin/bets/${p.id}`} className="adm-row-link">{p.userName || 'Unknown'}</Link></td>
                        <td className="adm-muted">{p.courseName}, hole {p.holeNumber}</td>
                        <td className="adm-num" style={{ fontWeight: 700 }}>{formatZAR(p.potentialWinCents)}</td>
                        {kind === 'owed' ? (
                          <>
                            <td className="adm-muted">{showDate(p.verifiedAt)}</td>
                            <td><Link href={`/admin/bets/${p.id}`} className="adm-link">Record the payout</Link></td>
                          </>
                        ) : (
                          <>
                            <td className="adm-muted">{showDate(p.paidAt)}</td>
                            <td className="adm-mono">{p.payoutReference ?? '—'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={payoutPage} totalPages={payoutData.totalPages} total={payoutData.total} onPageChange={setPayoutPage} />
            </>
          )}
        </div>
      )}

      {tab === 'free' && (
        <div role="tabpanel" id="report-panel-free" aria-labelledby="report-tab-free">
          {free.failed ? (
            <LoadError what="The free swing report" onRetry={free.retry} detail={free.detail} />
          ) : !free.data ? (
            <p className="adm-muted">Loading… this report counts every free swing, so it can take a moment.</p>
          ) : (
            <FreeSwings free={free.data} />
          )}
        </div>
      )}
    </div>
  )
}

/** Horizontal bars, each against the largest. */
function Bars({ rows }: { rows: { key: string; label: string; cents: number; count: number }[] }) {
  const max = Math.max(...rows.map(r => r.cents), 1)
  return (
    <div className="adm-stack" style={{ gap: 12 }}>
      {rows.map(r => (
        <div key={r.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 600, minWidth: 0 }}>{r.label}</span>
            <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatZAR(r.cents)}</span>
          </div>
          <div style={{ height: 8, background: 'var(--surface)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(r.cents / max) * 100}%`, background: 'var(--green)', borderRadius: 4 }} />
          </div>
          <div className="adm-small" style={{ marginTop: 2 }}>{r.count.toLocaleString('en-ZA')} {r.count === 1 ? 'entry' : 'entries'}</div>
        </div>
      ))}
    </div>
  )
}

function FreeSwings({ free }: { free: FreeSwingData }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
        <Tile
          title="Free swings taken"
          value={free.taken.toLocaleString('en-ZA')}
          icon={Gift}
          subtitle={`${free.taken7d} in the last 7 days · ${free.taken30d} in 30`}
        />
        <Tile
          title="Staked within 7 days"
          value={free.conversionRate7d != null ? `${free.conversionRate7d}%` : '—'}
          icon={TrendingUp}
          subtitle={
            free.conversionRate7d != null
              ? `${free.converted7d} of ${free.matured} whose week has closed${free.pending ? ` · ${free.pending} still inside theirs` : ''}`
              : `Nothing has had its full week yet${free.pending ? ` · ${free.pending} waiting` : ''}`
          }
        />
        <Tile
          title="Stakes after a free swing"
          value={formatZAR(free.revenueAfterFreeCents)}
          icon={Banknote}
          subtitle={`${formatZAR(free.revenuePerFreeSwingCents)} per free swing · ${free.paidBetsAfterFree} paid entries`}
        />
        <Tile
          title="Free aces claimed"
          value={String(free.claimed)}
          icon={Trophy}
          subtitle={`${formatZAR(free.prizeExposureCents)} in prizes with no stake behind them`}
        />
      </div>

      <section className="adm-card" style={{ marginBottom: 14 }}>
        <h2 className="adm-h2" style={{ marginBottom: 6 }}>Is one free swing enough?</h2>
        <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          The rate above is the share of golfers who took the free swing and then staked real money within
          seven days. It counts only swings old enough for that week to have closed, so a good week of
          sign-ups never drags it down. Of everyone who has ever taken one,{' '}
          <strong>
            {free.convertedEver}
            {free.conversionRateEver != null ? ` (${free.conversionRateEver}%)` : ''}
          </strong>{' '}
          {free.convertedEver === 1 ? 'has' : 'have'} staked something since
          {free.medianHoursToFirstPaid != null
            ? `, typically ${free.medianHoursToFirstPaid < 48
                ? `${Math.round(free.medianHoursToFirstPaid)} hours`
                : `${(free.medianHoursToFirstPaid / 24).toFixed(1)} days`} after the free shot`
            : ''}.
          If the rate stays low, the step to fix is the one from free to R50, not a second free swing.
        </p>
      </section>

      <div className="adm-card adm-table-wrap" style={{ padding: '8px 12px' }}>
        <table className="adm-table">
          <thead>
            <tr>
              <th>Week of</th>
              <th className="adm-num">Taken</th>
              <th className="adm-num">Week closed</th>
              <th className="adm-num">Staked in 7 days</th>
              <th className="adm-num">Rate</th>
            </tr>
          </thead>
          <tbody>
            {free.weeks.length === 0 ? (
              <tr><td colSpan={5} className="adm-muted" style={{ padding: 28, textAlign: 'center' }}>No free swings taken yet.</td></tr>
            ) : free.weeks.map(w => (
              <tr key={w.weekStart}>
                <td style={{ fontWeight: 700 }}>{showDate(w.weekStart)}</td>
                <td className="adm-num">{w.taken}</td>
                <td className="adm-num adm-muted">{w.matured}</td>
                <td className="adm-num">{w.converted}</td>
                <td className="adm-num" style={{ fontWeight: 700 }}>{w.rate != null ? `${w.rate}%` : <span className="adm-muted">Still open</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
