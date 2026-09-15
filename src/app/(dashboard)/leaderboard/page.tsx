'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import BottomTabBar from '@/components/layout/BottomTabBar'
import AppHeader from '@/components/layout/AppHeader'
import { useAuth } from '@/context/AuthContext'

type Tab = 'biggest' | 'recent'

interface Winner {
  rank: number
  initials: string
  name: string
  amount: number
  course: string
  stake: number
  date: string
}

const BIGGEST_WINNERS: Winner[] = [
  { rank: 1, initials: 'TM', name: 'Thabo M.', amount: 500000, course: 'Leopard Creek', stake: 500, date: '12 Feb' },
  { rank: 2, initials: 'SR', name: 'Sarah R.', amount: 200000, course: 'Fancourt Estate', stake: 250, date: '28 Jan' },
  { rank: 3, initials: 'JK', name: 'James K.', amount: 200000, course: 'Pearl Valley', stake: 250, date: '3 Feb' },
  { rank: 4, initials: 'AN', name: 'Anika N.', amount: 60000, course: 'Boschenmeer GC', stake: 100, date: '9 Mar' },
  { rank: 5, initials: 'PD', name: 'Pete D.', amount: 60000, course: 'Zimbali CC', stake: 100, date: '1 Mar' },
  { rank: 6, initials: 'LS', name: 'Laura S.', amount: 25000, course: 'Atlantic Beach', stake: 50, date: '7 Mar' },
  { rank: 7, initials: 'MO', name: 'Mike O.', amount: 25000, course: 'Erinvale GC', stake: 50, date: '5 Mar' },
  { rank: 8, initials: 'CB', name: 'Chloe B.', amount: 25000, course: 'Steenberg GC', stake: 50, date: '2 Mar' },
]

const RECENT_WINNERS: Winner[] = [
  { rank: 1, initials: 'AN', name: 'Anika N.', amount: 60000, course: 'Boschenmeer GC', stake: 100, date: 'Today' },
  { rank: 2, initials: 'LS', name: 'Laura S.', amount: 25000, course: 'Atlantic Beach', stake: 50, date: 'Yesterday' },
  { rank: 3, initials: 'MO', name: 'Mike O.', amount: 25000, course: 'Erinvale GC', stake: 50, date: '2 days ago' },
  { rank: 4, initials: 'PD', name: 'Pete D.', amount: 60000, course: 'Zimbali CC', stake: 100, date: '7 days ago' },
  { rank: 5, initials: 'CB', name: 'Chloe B.', amount: 25000, course: 'Steenberg GC', stake: 50, date: '8 days ago' },
  { rank: 6, initials: 'JK', name: 'James K.', amount: 200000, course: 'Pearl Valley', stake: 250, date: '35 days ago' },
  { rank: 7, initials: 'SR', name: 'Sarah R.', amount: 200000, course: 'Fancourt Estate', stake: 250, date: '40 days ago' },
  { rank: 8, initials: 'TM', name: 'Thabo M.', amount: 500000, course: 'Leopard Creek', stake: 500, date: '56 days ago' },
]

function getInitials(name: string | null | undefined, email: string | null | undefined) {
  if (name) return name.split(' ').map((p: string) => p[0]).join('').toUpperCase().slice(0, 2)
  if (email) return email[0].toUpperCase()
  return 'GL'
}

function formatRand(amount: number) {
  return `R${amount.toLocaleString('en-ZA').replace(/,/g, ' ')}`
}

/**
 * Winners — the wall of aces in the V2 system.
 * Display title with the running total, a segmented toggle between biggest
 * and most recent, a three-up podium with the leader in green and lime,
 * the signed-in golfer's own row as a nudge to play, then the rest as
 * white rows with display-face amounts.
 */
export default function LeaderboardPage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const [tab, setTab] = useState<Tab>('biggest')

  const displayName = profile?.name ?? user?.user_metadata?.full_name ?? null
  const userInitials = getInitials(displayName, user?.email)
  const firstName = displayName?.split(' ')[0] ?? 'You'

  const data = tab === 'biggest' ? BIGGEST_WINNERS : RECENT_WINNERS
  const podium = data.slice(0, 3)
  const rest = data.slice(3)

  const totalPaidOut = BIGGEST_WINNERS.reduce((s, w) => s + w.amount, 0)

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="vf-scroll">
          <h1 className="v2-title" style={{ marginBottom: 6 }}>Winners</h1>
          <p className="vf-sub" style={{ marginBottom: 0 }}>{formatRand(totalPaidOut)} paid out to date</p>

          <div className="lb-seg" role="tablist" aria-label="Winners list view">
            <button role="tab" type="button" aria-selected={tab === 'biggest'} className={`lb-tab${tab === 'biggest' ? ' active' : ''}`} onClick={() => setTab('biggest')}>
              Biggest wins
            </button>
            <button role="tab" type="button" aria-selected={tab === 'recent'} className={`lb-tab${tab === 'recent' ? ' active' : ''}`} onClick={() => setTab('recent')}>
              Most recent
            </button>
          </div>

          {/* Podium: 2 · 1 · 3 */}
          <div className="lb-podium" key={tab}>
            {[podium[1], podium[0], podium[2]].map(w => (
              <div key={w.rank} className={`lb-podium-item rank-${w.rank}`}>
                <span className="lb-podium-rank" aria-label={`Rank ${w.rank}`}>#{w.rank}</span>
                <div className="lb-podium-avatar" aria-hidden>{w.initials}</div>
                <div className="lb-podium-name">{w.name}</div>
                <div className="lb-podium-amount">{formatRand(w.amount)}</div>
                <div className="lb-podium-course">{w.course}</div>
              </div>
            ))}
          </div>

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

          <div className="lb-list">
            {rest.map(w => (
              <div key={w.rank} className="lb-row">
                <div className="lb-rank">{w.rank}</div>
                <div className="lb-avatar" aria-hidden>{w.initials}</div>
                <div className="lb-info">
                  <div className="lb-name">{w.name}</div>
                  <div className="lb-sub">{w.course} · {w.date}</div>
                </div>
                <div className="lb-amount">{formatRand(w.amount)}</div>
              </div>
            ))}
          </div>

          <p className="lb-note">All prizes independently verified · Updated daily</p>
        </div>

        <BottomTabBar active="leaderboard" />
      </div>
    </PhoneFrame>
  )
}
