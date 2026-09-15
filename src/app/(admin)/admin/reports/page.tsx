'use client'

import { useState, useEffect } from 'react'
import { DollarSign, TrendingUp, BarChart3, Trophy, Download } from 'lucide-react'
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
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'payouts'>('overview')

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/reports/revenue').then(r => r.json()),
      fetch(`/api/admin/reports/payouts?page=${payoutPage}`).then(r => r.json()),
    ])
      .then(([rev, pay]) => {
        setRevenue(rev)
        setPayouts(pay.data || [])
        setPayoutTotal(pay.total || 0)
        setPayoutTotalPages(pay.totalPages || 1)
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
        {[{ key: 'overview', label: 'Revenue Breakdown' }, { key: 'payouts', label: 'Payout History' }].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as 'overview' | 'payouts')}
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
    </div>
  )
}
