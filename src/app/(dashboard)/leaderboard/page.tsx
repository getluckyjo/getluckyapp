'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import BottomTabBar from '@/components/layout/BottomTabBar'
import AppHeader from '@/components/layout/AppHeader'
import { useAuth } from '@/context/AuthContext'

type Tab = 'biggest' | 'recent'

interface Winner {
  id: string
  name: string
  initials: string
  amountCents: number
  stakeCents: number
  course: string
  paidAt: string
}

function getInitials(name: string | null | undefined, email: string | null | undefined) {
  if (name) return name.split(' ').map((p: string) => p[0]).join('').toUpperCase().slice(0, 2)
  if (email) return email[0].toUpperCase()
  return 'GL'
}

function formatRand(cents: number) {
  return `R${Math.round(cents / 100).toLocaleString('en-ZA').replace(/,/g, ' ')}`
}

function formatDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
}

/**
 * Winners — real, paid-out hole-in-ones from /api/winners (anonymised to
 * "First L."). Empty until the first prize is paid; it does not pretend
 * otherwise.
 */
export default function LeaderboardPage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const [tab, setTab] = useState<Tab>('biggest')
  const [winners, setWinners] = useState<Winner[] | null>(null)
  const [totalPaidOut, setTotalPaidOut] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/winners')
      .then(r => (r.ok ? r.json() : { winners: [], totalPaidOutCents: 0 }))
      .then((data: { winners: Winner[]; totalPaidOutCents: number }) => {
        if (cancelled) return
        setWinners(data.winners ?? [])
        setTotalPaidOut(data.totalPaidOutCents ?? 0)
      })
      .catch(() => { if (!cancelled) setWinners([]) })
    return () => { cancelled = true }
  }, [])

  const displayName = profile?.name ?? user?.user_metadata?.full_name ?? null
  const userInitials = getInitials(displayName, user?.email)
  const firstName = displayName?.split(' ')[0] ?? 'You'

  const sorted = [...(winners ?? [])].sort((a, b) =>
    tab === 'biggest' ? b.amountCents - a.amountCents : Date.parse(b.paidAt) - Date.parse(a.paidAt),
  ).map((w, i) => ({ ...w, rank: i + 1 }))
  const hasPodium = sorted.length >= 3
  const podium = hasPodium ? sorted.slice(0, 3) : []
  const rest = hasPodium ? sorted.slice(3) : sorted

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="vf-scroll">
          <h1 className="v2-title" style={{ marginBottom: 6 }}>Winners</h1>
          <p className="vf-sub" style={{ marginBottom: 0 }}>
            {winners === null ? 'Loading…' : totalPaidOut > 0 ? `${formatRand(totalPaidOut)} paid out to date` : 'No prizes paid out yet'}
          </p>

          <div className="lb-seg" role="tablist" aria-label="Winners list view">
            <button role="tab" type="button" aria-selected={tab === 'biggest'} className={`lb-tab${tab === 'biggest' ? ' active' : ''}`} onClick={() => setTab('biggest')}>
              Biggest wins
            </button>
            <button role="tab" type="button" aria-selected={tab === 'recent'} className={`lb-tab${tab === 'recent' ? ' active' : ''}`} onClick={() => setTab('recent')}>
              Most recent
            </button>
          </div>

          {hasPodium && (
            <div className="lb-podium" key={tab}>
              {[podium[1], podium[0], podium[2]].map(w => (
                <div key={w.id} className={`lb-podium-item rank-${w.rank}`}>
                  <span className="lb-podium-rank" aria-label={`Rank ${w.rank}`}>#{w.rank}</span>
                  <div className="lb-podium-avatar" aria-hidden>{w.initials}</div>
                  <div className="lb-podium-name">{w.name}</div>
                  <div className="lb-podium-amount">{formatRand(w.amountCents)}</div>
                  <div className="lb-podium-course">{w.course}</div>
                </div>
              ))}
            </div>
          )}

          {user && (
            <div className="lb-you">
              <div className="lb-avatar" aria-hidden>{userInitials}</div>
              <div className="lb-info">
                <div className="lb-name">{firstName} (you)</div>
                <div className="lb-sub" style={{ whiteSpace: 'normal' }}>Win your first hole-in-one to appear here</div>
              </div>
              <button type="button" className="lb-you-cta" onClick={() => router.push('/select-course')}>
                Play
              </button>
            </div>
          )}

          {winners !== null && sorted.length === 0 && (
            <p className="lb-note" style={{ marginTop: 24 }}>
              The first verified hole-in-one will appear here. It could be yours.
            </p>
          )}

          <div className="lb-list">
            {rest.map(w => (
              <div key={w.id} className="lb-row">
                <div className="lb-rank">{w.rank}</div>
                <div className="lb-avatar" aria-hidden>{w.initials}</div>
                <div className="lb-info">
                  <div className="lb-name">{w.name}</div>
                  <div className="lb-sub">{w.course} · {formatDate(w.paidAt)}</div>
                </div>
                <div className="lb-amount">{formatRand(w.amountCents)}</div>
              </div>
            ))}
          </div>

          {sorted.length > 0 && (
            <p className="lb-note">Every prize listed was reviewed by our team and the insurer before payment.</p>
          )}
        </div>

        <BottomTabBar active="leaderboard" />
      </div>
    </PhoneFrame>
  )
}
