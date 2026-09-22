'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import PullToRefresh from '@/components/pwa/PullToRefresh'
import { useRefreshSignal } from '@/hooks/useRefreshSignal'
import BottomTabBar from '@/components/layout/BottomTabBar'
import AppHeader from '@/components/layout/AppHeader'
import { GolfBallIcon } from '@/components/icons'
import { formatRandFromCents as formatRand } from '@/lib/format'

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

type Outcome = 'won' | 'claimed' | 'miss'

function getOutcome(bet: BetRecord): Outcome {
  if (bet.status === 'paid' || bet.status === 'verified') return 'won'
  if (bet.declared_result === 'win' || bet.status === 'claimed') return 'claimed'
  return 'miss'
}

const OUTCOME_LABEL: Record<Outcome, string> = { won: 'Won', claimed: 'Claimed', miss: 'Miss' }

function matchesFilter(bet: BetRecord, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'miss') return bet.declared_result === 'miss' || bet.status === 'miss'
  if (filter === 'claimed') return bet.declared_result === 'win' || bet.status === 'claimed'
  if (filter === 'won') return bet.status === 'paid' || bet.status === 'verified'
  return true
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

const PAGE_SIZE = 20

/**
 * My shots — every attempt the golfer has made, in the V2 system.
 * Display title, three stat tiles, a row of filter pills, then white
 * cards: a ball disc (lime when it went in), course and hole, an outcome
 * badge, and the stake / prize line underneath.
 */
export default function HistoryPage() {
  const router = useRouter()
  const [allBets, setAllBets] = useState<BetRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const refreshTick = useRefreshSignal()

  useEffect(() => {
    fetch('/api/bets?limit=200')
      .then(r => r.json())
      .then(data => { if (data.bets) setAllBets(data.bets) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [refreshTick])

  const filtered = allBets.filter(b => matchesFilter(b, filter))
  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  const handleFilter = useCallback((f: Filter) => {
    setFilter(f)
    setVisibleCount(PAGE_SIZE)
  }, [])

  const totalStaked = allBets.reduce((s, b) => s + b.stake_pence, 0)
  const totalWon = allBets.filter(b => getOutcome(b) === 'won').reduce((s, b) => s + b.potential_win_pence, 0)
  const claimCount = allBets.filter(b => getOutcome(b) !== 'miss').length

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <PullToRefresh />
        <AppHeader tone="light" />

        <div className="vf-scroll">
          <header className="page-head" style={{ padding: 0 }}>
            <h1 className="v2-title" style={{ marginBottom: 0 }}>My shots</h1>
            <div className="page-sub" style={{ whiteSpace: 'nowrap', paddingBottom: 6 }}>
              {loading ? '—' : allBets.length} total
            </div>
          </header>

          {/* Summary */}
          <div className="hist-summary">
            {loading ? (
              [0, 1, 2].map(i => (
                <div key={i} className="hist-stat">
                  <div className="skeleton" style={{ height: 20, width: '70%', margin: '0 auto 6px' }} />
                  <div className="skeleton" style={{ height: 10, width: '55%', margin: '0 auto' }} />
                </div>
              ))
            ) : (
              <>
                <div className="hist-stat">
                  <div className="hist-stat-val">{allBets.length}</div>
                  <div className="hist-stat-label">Attempts</div>
                </div>
                <div className="hist-stat">
                  <div className="hist-stat-val">{formatRand(totalStaked)}</div>
                  <div className="hist-stat-label">Staked</div>
                </div>
                <div className="hist-stat">
                  <div className="hist-stat-val">
                    {totalWon > 0 ? formatRand(totalWon) : claimCount > 0 ? claimCount : 'R0'}
                  </div>
                  <div className="hist-stat-label">{totalWon > 0 ? 'Won' : claimCount > 0 ? 'Claims' : 'Won'}</div>
                </div>
              </>
            )}
          </div>

          {/* Filter chips */}
          <div className="hist-filters" role="group" aria-label="Filter shots">
            {FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                className={`filter-chip${filter === f.key ? ' active' : ''}`}
                onClick={() => handleFilter(f.key)}
              >
                {f.label}
                {!loading && f.key !== 'all' && (
                  <small>{allBets.filter(b => matchesFilter(b, f.key)).length}</small>
                )}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="hist-list">
            {loading ? (
              [0, 1, 2, 3].map(i => (
                <div key={i} className="hist-card">
                  <div className="hist-card-top">
                    <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div className="skeleton" style={{ height: 14, width: '65%', marginBottom: 6 }} />
                      <div className="skeleton" style={{ height: 11, width: '45%' }} />
                    </div>
                    <div className="skeleton" style={{ height: 22, width: 50, borderRadius: 999, flexShrink: 0 }} />
                  </div>
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div className="hist-empty">
                <span className="nf-ball" aria-hidden><GolfBallIcon size={38} /></span>
                <div className="hist-empty-title">
                  {filter === 'all' ? 'No shots yet' : `No ${FILTERS.find(f => f.key === filter)?.label.toLowerCase()} yet`}
                </div>
                <div className="hist-empty-sub">
                  {filter === 'all'
                    ? 'Pick a par 3 and take your first shot.'
                    : 'Try a different filter above.'}
                </div>
                {filter === 'all' && (
                  <button type="button" className="btn-lime" onClick={() => router.push('/select-course')}>
                    Play now
                  </button>
                )}
              </div>
            ) : (
              visible.map(bet => {
                const outcome = getOutcome(bet)
                return (
                  <div key={bet.id} className={`hist-card${outcome === 'won' ? ' is-won' : ''}`}>
                    <div className="hist-card-top">
                      <span className="hist-card-icon" aria-hidden><GolfBallIcon size={22} /></span>
                      <div className="hist-card-meta">
                        <div className="hist-card-course">{bet.courses?.name ?? 'Unknown course'}</div>
                        <div className="hist-card-sub">
                          Hole {bet.holes?.hole_number ?? '?'} · Par {bet.holes?.par ?? 3} · {formatDate(bet.created_at)}
                        </div>
                      </div>
                      <span className={`hist-badge hist-badge--${outcome}`}>{OUTCOME_LABEL[outcome]}</span>
                    </div>
                    <div className="hist-card-foot">
                      <span className="hist-card-stake">Staked {formatRand(bet.stake_pence)}</span>
                      <span className="hist-card-win">
                        {outcome === 'won' ? 'Won' : 'Prize'}<strong>{formatRand(bet.potential_win_pence)}</strong>
                      </span>
                    </div>
                  </div>
                )
              })
            )}

            {hasMore && !loading && (
              <button
                type="button"
                className="btn-tile btn-tile--block hist-more"
                onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              >
                Load more ({filtered.length - visibleCount} remaining)
              </button>
            )}
          </div>
        </div>

        <BottomTabBar active="history" />
      </div>
    </PhoneFrame>
  )
}
