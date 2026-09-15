'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import BottomTabBar from '@/components/layout/BottomTabBar'
import AppHeader from '@/components/layout/AppHeader'
import { GolfBallIcon } from '@/components/icons'

interface BetRecord {
  id: string
  tier: string
  stake_pence: number
  potential_win_pence: number
  status: string
  declared_result: string | null
  created_at: string
  courses: { id: string; name: string; location_text: string | null; region: string | null } | null
  holes: { id: string; hole_number: number; par: number; distance_metres: number | null } | null
}

type Filter = 'all' | 'miss' | 'claimed' | 'won'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'miss', label: 'Misses' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'won', label: 'Won' },
]

function getStatusBadge(bet: BetRecord) {
  if (bet.status === 'paid' || bet.status === 'verified') {
    return { label: 'Won!', bg: 'rgba(74,157,91,0.12)', color: '#2d6a3f' }
  }
  if (bet.declared_result === 'win' || bet.status === 'claimed') {
    return { label: 'Claimed', bg: 'rgba(201,168,76,0.15)', color: '#a07820' }
  }
  return { label: 'Miss', bg: '#f5f0e8', color: '#999' }
}

function matchesFilter(bet: BetRecord, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'miss') return bet.declared_result === 'miss' || bet.status === 'miss'
  if (filter === 'claimed') return bet.declared_result === 'win' || bet.status === 'claimed'
  if (filter === 'won') return bet.status === 'paid' || bet.status === 'verified'
  return true
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function formatStake(cents: number) {
  return `R${(cents / 100).toLocaleString('en-ZA')}`
}

function formatWin(cents: number) {
  return `R${(cents / 100).toLocaleString('en-ZA')}`
}

const PAGE_SIZE = 20

export default function HistoryPage() {
  const router = useRouter()
  const [allBets, setAllBets] = useState<BetRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    fetch('/api/bets?limit=200')
      .then(r => r.json())
      .then(data => { if (data.bets) setAllBets(data.bets) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = allBets.filter(b => matchesFilter(b, filter))
  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  // Reset visible count when filter changes
  const handleFilter = useCallback((f: Filter) => {
    setFilter(f)
    setVisibleCount(PAGE_SIZE)
  }, [])

  // Summary stats
  const totalStaked = allBets.reduce((s, b) => s + b.stake_pence, 0)
  const totalWon = allBets
    .filter(b => b.status === 'paid' || b.status === 'verified')
    .reduce((s, b) => s + b.potential_win_pence, 0)
  const claimCount = allBets.filter(b =>
    b.declared_result === 'win' || b.status === 'claimed' || b.status === 'paid' || b.status === 'verified'
  ).length

  return (
    <PhoneFrame statusTheme="dark" hideSponsor>
      <div className="screen-history">
        <AppHeader tone="light" />
        <header className="page-head">
          <h1 className="page-title">My Bets</h1>
          <div className="page-sub" style={{ whiteSpace: 'nowrap', paddingBottom: 4 }}>
            {loading ? '—' : allBets.length} total
          </div>
        </header>

        {/* Summary */}
        <div className="history-summary">
          {loading ? (
            [0, 1, 2].map(i => (
              <div key={i} className="history-summary-card">
                <div className="skeleton" style={{ height: 20, width: '70%', margin: '0 auto 6px', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 10, width: '55%', margin: '0 auto', borderRadius: 3 }} />
              </div>
            ))
          ) : (
            <>
              <div className="history-summary-card">
                <div className="history-summary-val">{allBets.length}</div>
                <div className="history-summary-label">Attempts</div>
              </div>
              <div className="history-summary-card">
                <div className="history-summary-val">{formatStake(totalStaked)}</div>
                <div className="history-summary-label">Total Staked</div>
              </div>
              <div className="history-summary-card">
                <div className="history-summary-val" style={{ color: claimCount > 0 ? 'var(--gold)' : undefined }}>
                  {totalWon > 0 ? formatWin(totalWon) : claimCount > 0 ? `${claimCount} claim${claimCount > 1 ? 's' : ''}` : 'R0'}
                </div>
                <div className="history-summary-label">{totalWon > 0 ? 'Won' : 'Claims'}</div>
              </div>
            </>
          )}
        </div>

        {/* Filter chips */}
        <div className="history-filters" role="group" aria-label="Filter bets">
          {FILTERS.map(f => (
            <button
              key={f.key}
              aria-pressed={filter === f.key}
              className={`filter-chip${filter === f.key ? ' active' : ''}`}
              onClick={() => handleFilter(f.key)}
            >
              {f.label}
              {!loading && f.key !== 'all' && (
                <span style={{ marginLeft: 5, opacity: 0.7 }}>
                  ({allBets.filter(b => matchesFilter(b, f.key)).length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="history-list">
          {loading ? (
            [0, 1, 2, 4].map(i => (
              <div key={i} className="history-bet-card">
                <div className="history-bet-top">
                  <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton" style={{ height: 14, width: '65%', marginBottom: 6, borderRadius: 4 }} />
                    <div className="skeleton" style={{ height: 11, width: '45%', borderRadius: 3 }} />
                  </div>
                  <div className="skeleton" style={{ height: 22, width: 44, borderRadius: 6, flexShrink: 0 }} />
                </div>
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="history-empty">
              <div className="history-empty-icon" aria-hidden><GolfBallIcon size={52} ball="#fff" style={{ color: 'var(--green)' }} /></div>
              <div className="history-empty-title">
                {filter === 'all' ? 'No bets yet' : `No ${FILTERS.find(f => f.key === filter)?.label.toLowerCase()} bets`}
              </div>
              <div className="history-empty-sub">
                {filter === 'all'
                  ? 'Select a course and take your first shot!'
                  : 'Try a different filter above.'}
              </div>
            </div>
          ) : (
            <>
              {visible.map(bet => {
                const badge = getStatusBadge(bet)
                return (
                  <div key={bet.id} className="history-bet-card fade-up">
                    <div className="history-bet-top">
                      <div className="history-bet-icon">⛳</div>
                      <div className="history-bet-meta">
                        <div className="history-bet-course">
                          {bet.courses?.name ?? 'Unknown Course'}
                        </div>
                        <div className="history-bet-sub">
                          Hole {bet.holes?.hole_number ?? '?'} · Par {bet.holes?.par ?? 3} · {formatDate(bet.created_at)}
                        </div>
                      </div>
                      <div
                        className="history-bet-badge"
                        style={{ background: badge.bg, color: badge.color }}
                      >
                        {badge.label}
                      </div>
                    </div>
                    <div className="history-bet-footer">
                      <div className="history-bet-stake">
                        Staked {formatStake(bet.stake_pence)}
                      </div>
                      <div className="history-bet-win">
                        Win {formatWin(bet.potential_win_pence)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Load more */}
        {hasMore && !loading && (
          <button
            className="history-load-more"
            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
          >
            Load more ({filtered.length - visibleCount} remaining)
          </button>
        )}
      </div>

      {/* Bottom tab bar */}
      <BottomTabBar active="history" />
    </PhoneFrame>
  )
}
