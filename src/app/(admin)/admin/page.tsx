'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Banknote, Ticket, ClipboardCheck, Hourglass, Trophy, HandCoins, Users, ArrowRight, Download } from 'lucide-react'
import StatCard from '@/components/admin/StatCard'
import StatusBadge from '@/components/admin/StatusBadge'
import LoadError from '@/components/admin/LoadError'
import { formatZAR, timeAgo } from '@/lib/format'
import { TIER_LABELS } from '@/lib/tiers'
import type { AdminBetRecord, VerificationQueueItem } from '@/types/admin'
import { downloadExport } from '@/app/(admin)/admin/bets/client-helpers'

/** /api/admin/stats. The figures from migration 032 are null before it runs. */
interface DashboardStats {
  totalRevenue: number
  totalPayouts: number
  totalBets: number
  activeBets: number
  pendingClaims: number
  totalUsers: number
  expiredBets: number | null
  claimsToReview: number | null
  claimsWaiting: number | null
  prizesOwed: number | null
  recentBets: AdminBetRecord[]
  /** The oldest open claims, oldest first. */
  recentVerifications: VerificationQueueItem[]
}

const SAST = 'Africa/Johannesburg'
const WEEK = 7 * 24 * 3_600_000

/** timeAgo, with the date it falls back to after a week read in South Africa (format.ts's takes no time zone). */
function ago(iso: string): string {
  if (Date.now() - Date.parse(iso) < WEEK) return timeAgo(iso)
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: SAST })
}

/** A figure the server did not send is "—", never a zero that is not true. */
const count = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-ZA'))
const money = (cents: number | null | undefined) => (cents == null ? '—' : formatZAR(cents))

/** A stat card in its own box: admin.css spaces a card that follows another (.adm-card + .adm-card), which in a row would push all but the first down. */
function Tile(props: React.ComponentProps<typeof StatCard>) {
  return <div style={{ flex: '1 1 210px', display: 'flex', minWidth: 0 }}><StatCard {...props} /></div>
}

export default function AdminDashboardPage() {
  const [attempt, setAttempt] = useState(0)
  // stats null: the load failed. Loading is an answer for an earlier attempt, or none yet.
  const [answer, setAnswer] = useState<{ attempt: number; stats: DashboardStats | null; detail: string | null } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<{ error: boolean; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/stats', { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (cancelled) return
        setAnswer(res.ok && json ? { attempt, stats: json as DashboardStats, detail: null } : { attempt, stats: null, detail: json?.error ?? null })
      })
      .catch(() => { if (!cancelled) setAnswer({ attempt, stats: null, detail: null }) })
    return () => { cancelled = true }
  }, [attempt])

  const loading = answer?.attempt !== attempt
  const stats = loading ? null : answer.stats

  async function exportBets() {
    setExportNote(null)
    setExporting(true)
    const result = await downloadExport({ type: 'bets' })
    setExporting(false)
    if (!result.ok) setExportNote({ error: true, text: `The export failed. ${result.error}` })
    else if (result.cappedAt) setExportNote({ error: false, text: `The file holds the newest ${result.cappedAt.toLocaleString('en-ZA')} bets only. Filter them on the Bets page to export the rest.` })
  }

  // The admin's own work: claims with documents in. Before 032 only the combined count exists.
  const toReview = stats ? stats.claimsToReview ?? stats.pendingClaims : 0

  return (
    <div>
      <title>Dashboard · Get Lucky admin</title>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">Dashboard</h1>
          <p className="adm-lead">Stakes, prizes and the claims waiting on you, across every course.</p>
        </div>
      </div>

      {loading ? (
        <div aria-busy="true" aria-label="Loading the dashboard" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 26 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="adm-card" style={{ flex: '1 1 210px', height: 104, marginTop: 0 }} />
          ))}
        </div>
      ) : !stats ? (
        <div style={{ marginBottom: 26 }}>
          <LoadError what="The dashboard" onRetry={() => setAttempt(n => n + 1)} detail={answer.detail} />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
            <Tile
              title="Stakes taken"
              value={money(stats.totalRevenue)}
              icon={Banknote}
              subtitle={`${count(stats.totalBets)} entries, free swings included`}
            />
            <Tile
              title="Active bets"
              value={count(stats.activeBets)}
              icon={Ticket}
              subtitle={stats.expiredBets == null ? 'Including any that expired unplayed' : `Still open to play · ${count(stats.expiredBets)} expired unplayed`}
            />
            {stats.claimsToReview == null ? (
              <Tile title="Open claims" value={count(stats.pendingClaims)} icon={ClipboardCheck} subtitle="Waiting on you or on the golfer" />
            ) : (
              <>
                <Tile
                  title="Claims to review"
                  value={count(stats.claimsToReview)}
                  icon={ClipboardCheck}
                  subtitle={stats.claimsToReview > 0 ? 'Documents in, waiting on you' : 'Nothing waiting on you'}
                />
                <Tile title="Waiting on golfer" value={count(stats.claimsWaiting)} icon={Hourglass} subtitle="Their documents are not in yet" />
              </>
            )}
            <Tile title="Prizes paid" value={money(stats.totalPayouts)} icon={Trophy} />
            {stats.prizesOwed != null && (
              <Tile title="Prizes owed" value={money(stats.prizesOwed)} icon={HandCoins} subtitle="Verified, not yet paid" />
            )}
            <Tile title="Users" value={count(stats.totalUsers)} icon={Users} />
          </div>

          <div className="adm-row" style={{ alignItems: 'center', marginBottom: 26 }}>
            {toReview > 0 && (
              <Link href="/admin/verification-queue" className="adm-btn" style={{ textDecoration: 'none' }}>
                <ClipboardCheck size={18} aria-hidden /> Review {toReview} {toReview === 1 ? 'claim' : 'claims'}
              </Link>
            )}
            <Link href="/admin/courses/new" className="adm-btn adm-btn--quiet" style={{ textDecoration: 'none' }}>
              Add a course <ArrowRight size={15} aria-hidden />
            </Link>
            <button type="button" onClick={exportBets} disabled={exporting} className="adm-btn adm-btn--quiet">
              <Download size={15} aria-hidden /> {exporting ? 'Preparing…' : 'Download bets (CSV)'}
            </button>
            {exportNote && <span role={exportNote.error ? 'alert' : 'status'} className={exportNote.error ? 'adm-error' : 'adm-small'}>{exportNote.text}</span>}
          </div>

          <div className="adm-grid-2">
            <section className="adm-card" style={{ marginTop: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <h2 className="adm-h2">Newest bets</h2>
                <Link href="/admin/bets" className="adm-link" style={{ fontSize: 13 }}>View all</Link>
              </div>
              {stats.recentBets.length === 0 ? (
                <p className="adm-muted" style={{ margin: '8px 0 0' }}>No bets yet.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {stats.recentBets.map(bet => (
                    <Row
                      key={bet.id}
                      href={`/admin/bets/${bet.id}`}
                      name={bet.userName || 'Unknown'}
                      detail={`${bet.courseName} · ${TIER_LABELS[bet.tier]}`}
                      status={bet.status}
                      at={bet.createdAt}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="adm-card" style={{ marginTop: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <h2 className="adm-h2">Oldest open claims</h2>
                <Link href="/admin/verification-queue" className="adm-link" style={{ fontSize: 13 }}>View queue</Link>
              </div>
              {stats.recentVerifications.length === 0 ? (
                <p className="adm-muted" style={{ margin: '8px 0 0' }}>No open claims.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {stats.recentVerifications.map(v => (
                    <Row
                      key={v.id}
                      href={`/admin/verification-queue/${v.id}`}
                      name={v.userName || 'Unknown'}
                      detail={`${v.courseName} · ${formatZAR(v.potentialWinCents)}`}
                      status={v.status}
                      at={v.createdAt}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}

/** One line of a dashboard list: the whole line is the link. */
function Row({ href, name, detail, status, at }: { href: string; name: string; detail: string; status: string; at: string }) {
  return (
    <li style={{ borderTop: '1px solid var(--surface)' }}>
      <Link href={href} className="adm-row-link" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0' }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14 }}>{name}</span>
          <span className="adm-small" style={{ display: 'block', fontWeight: 500 }}>{detail}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <StatusBadge status={status} small />
          <span className="adm-small" style={{ fontWeight: 500 }}>{ago(at)}</span>
        </span>
      </Link>
    </li>
  )
}
