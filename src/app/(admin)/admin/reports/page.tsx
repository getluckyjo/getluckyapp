'use client'

import { useState, useEffect } from 'react'
import { DollarSign, TrendingUp, BarChart3, Trophy, Download, Gift } from 'lucide-react'
import StatCard from '@/components/admin/StatCard'
import StatusBadge from '@/components/admin/StatusBadge'
import Pagination from '@/components/admin/Pagination'
import { formatZAR, timeAgo } from '@/lib/format'

interface RevenueData {
  totalRevenue: number
  totalPayouts: number
  netProfit: number
  margin: string
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

interface PayoutItem {
  id: string
  userName: string
  courseName: string
  holeNumber: number
  tier: string
  potentialWinCents: number
  status: string
  createdAt: string
}

export default function AdminReportsPage() {
  const [revenue, setRevenue] = useState<RevenueData | null>(null)
  const [payouts, setPayouts] = useState<PayoutItem[]>([])
  const [payoutTotal, setPayoutTotal] = useState(0)
  const [payoutPage, setPayoutPage] = useState(1)
  const [payoutTotalPages, setPayoutTotalPages] = useState(1)
  const [free, setFree] = useState<FreeSwingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'payouts' | 'free'>('overview')

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/reports/revenue').then(r => r.json()),
      fetch(`/api/admin/reports/payouts?page=${payoutPage}`).then(r => r.json()),
      fetch('/api/admin/reports/free-swings').then(r => r.json()),
    ])
      .then(([rev, pay, freeSwings]) => {
        setRevenue(rev)
        setPayouts(pay.data || [])
        setPayoutTotal(pay.total || 0)
        setPayoutTotalPages(pay.totalPages || 1)
        setFree(freeSwings)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [payoutPage])

  const handleExport = async (type: string) => {
    const res = await fetch('/api/admin/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${type}-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading reports...</div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>Financial Reports</h1>
          <p style={{ fontSize: 14, color: '#666' }}>Revenue, payouts, and profit analysis</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => handleExport('bets')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 8, border: '1px solid #e5e5e5', background: '#fff',
              fontSize: 13, cursor: 'pointer', color: '#333',
            }}
          >
            <Download size={14} /> Export Bets
          </button>
          <button
            onClick={() => handleExport('verifications')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 8, border: '1px solid #e5e5e5', background: '#fff',
              fontSize: 13, cursor: 'pointer', color: '#333',
            }}
          >
            <Download size={14} /> Export Claims
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatCard title="Total Revenue" value={formatZAR(revenue?.totalRevenue ?? 0)} icon={DollarSign} accent="#335231" subtitle={`${revenue?.totalBets ?? 0} bets via PayFast`} />
        <StatCard title="Total Payouts" value={formatZAR(revenue?.totalPayouts ?? 0)} icon={Trophy} accent="#c0392b" subtitle="Processed via PayFast" />
        <StatCard title="Net Profit" value={formatZAR(revenue?.netProfit ?? 0)} icon={TrendingUp} accent={(revenue?.netProfit ?? 0) >= 0 ? '#1a7f37' : '#c0392b'} subtitle={`${revenue?.margin ?? '0'}% margin`} />
        <StatCard title="Total Bets" value={String(revenue?.totalBets ?? 0)} icon={BarChart3} accent="#1565c0" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e5e5', marginBottom: 20 }}>
        {[{ key: 'overview', label: 'Revenue Breakdown' }, { key: 'payouts', label: 'Payout History' }, { key: 'free', label: 'Free Swings' }].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as 'overview' | 'payouts' | 'free')}
            style={{
              padding: '10px 20px', background: 'none', border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #335231' : '2px solid transparent',
              color: activeTab === tab.key ? '#335231' : '#666',
              fontWeight: activeTab === tab.key ? 600 : 400, fontSize: 14, cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Revenue by Tier */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 16 }}>Revenue by Tier</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(revenue?.byTier ?? []).map((item) => {
                const maxRev = Math.max(...(revenue?.byTier ?? []).map(t => t.revenue), 1)
                return (
                  <div key={item.tier}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                      <span style={{ color: '#333', fontWeight: 500 }}>{item.label}</span>
                      <span style={{ color: '#111', fontWeight: 600 }}>{formatZAR(item.revenue)}</span>
                    </div>
                    <div style={{ height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${(item.revenue / maxRev) * 100}%`,
                          background: '#335231',
                          borderRadius: 4,
                          transition: 'width 0.3s',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{item.count} bets</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Revenue by Course */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 16 }}>Revenue by Course</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(revenue?.byCourse ?? []).slice(0, 10).map((item, i) => {
                const maxRev = Math.max(...(revenue?.byCourse ?? []).map(c => c.revenue), 1)
                return (
                  <div key={item.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                      <span style={{ color: '#333', fontWeight: 500 }}>
                        <span style={{ color: '#999', marginRight: 6 }}>#{i + 1}</span>
                        {item.name}
                      </span>
                      <span style={{ color: '#111', fontWeight: 600 }}>{formatZAR(item.revenue)}</span>
                    </div>
                    <div style={{ height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${(item.revenue / maxRev) * 100}%`,
                          background: '#4a7a3d',
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{item.count} bets</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'payouts' && (
        <div>
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
                  <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>User</th>
                  <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Course</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Amount</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Status</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {payouts.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#999' }}>No payouts yet</td></tr>
                ) : (
                  payouts.map((p) => (
                    <tr key={p.id} className="admin-tr" style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 500, color: '#111' }}>{p.userName || 'Unknown'}</td>
                      <td style={{ padding: '12px 14px', color: '#666' }}>{p.courseName}, H{p.holeNumber}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#1a7f37' }}>
                        {formatZAR(p.potentialWinCents)}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <StatusBadge status={p.status} small />
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#999', fontSize: 12 }}>
                        {timeAgo(p.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={payoutPage} totalPages={payoutTotalPages} total={payoutTotal} onPageChange={setPayoutPage} />
        </div>
      )}

      {activeTab === 'free' && (
        <div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
            <StatCard
              title="Free Swings Taken"
              value={String(free?.taken ?? 0)}
              icon={Gift}
              accent="#335231"
              subtitle={`${free?.taken7d ?? 0} in the last 7 days · ${free?.taken30d ?? 0} in 30`}
            />
            <StatCard
              title="Stake Within 7 Days"
              value={free?.conversionRate7d != null ? `${free.conversionRate7d}%` : '—'}
              icon={TrendingUp}
              accent="#1a7f37"
              subtitle={
                free?.conversionRate7d != null
                  ? `${free.converted7d} of ${free.matured} whose week has closed${free.pending ? ` · ${free.pending} still inside theirs` : ''}`
                  : `Nothing has had its full week yet${free?.pending ? ` · ${free.pending} waiting` : ''}`
              }
            />
            <StatCard
              title="Stakes After a Free Swing"
              value={formatZAR(free?.revenueAfterFreeCents ?? 0)}
              icon={DollarSign}
              accent="#1565c0"
              subtitle={`${formatZAR(free?.revenuePerFreeSwingCents ?? 0)} per free swing · ${free?.paidBetsAfterFree ?? 0} paid entries`}
            />
            <StatCard
              title="Free Aces Claimed"
              value={String(free?.claimed ?? 0)}
              icon={Trophy}
              accent={(free?.claimed ?? 0) > 0 ? '#c0392b' : '#666'}
              subtitle={`${formatZAR(free?.prizeExposureCents ?? 0)} in prizes with no stake behind them`}
            />
          </div>

          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20, marginBottom: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 6 }}>Is one free swing enough?</h3>
            <p style={{ fontSize: 13, color: '#666', lineHeight: 1.6, margin: 0 }}>
              The rate above is the share of golfers who took the free swing and then staked real money within
              seven days. It counts only swings old enough for that week to have closed, so a good week of
              sign-ups never drags it down. Of everyone who has ever taken one,{' '}
              <strong style={{ color: '#111' }}>
                {free?.convertedEver ?? 0}
                {free?.conversionRateEver != null ? ` (${free.conversionRateEver}%)` : ''}
              </strong>{' '}
              has staked something since
              {free?.medianHoursToFirstPaid != null
                ? `, typically ${free.medianHoursToFirstPaid < 48
                    ? `${Math.round(free.medianHoursToFirstPaid)} hours`
                    : `${(free.medianHoursToFirstPaid / 24).toFixed(1)} days`} after the free shot`
                : ''}.
              If the rate stays low, the step to fix is the one from free to R50 — not a second free swing.
            </p>
          </div>

          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
                  <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Week of</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Taken</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Week closed</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Staked in 7 days</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Rate</th>
                </tr>
              </thead>
              <tbody>
                {(free?.weeks ?? []).length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#999' }}>No free swings taken yet</td></tr>
                ) : (
                  (free?.weeks ?? []).map((w) => (
                    <tr key={w.weekStart} className="admin-tr" style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 500, color: '#111' }}>
                        {new Date(w.weekStart).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#333' }}>{w.taken}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#999' }}>{w.matured}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#333' }}>{w.converted}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: w.rate != null ? '#1a7f37' : '#999' }}>
                        {w.rate != null ? `${w.rate}%` : 'Still open'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
