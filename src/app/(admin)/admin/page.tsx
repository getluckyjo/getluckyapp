'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { DollarSign, Ticket, ClipboardCheck, Trophy, Users, ArrowRight } from 'lucide-react'
import StatCard from '@/components/admin/StatCard'
import StatusBadge from '@/components/admin/StatusBadge'
import { formatZAR, timeAgo } from '@/lib/format'
import { TIER_LABELS } from '@/lib/tiers'
import type { AdminStats } from '@/types/admin'

export default function AdminDashboardPage() {
  const router = useRouter()
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/stats')
      .then(r => r.json())
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 24, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>Dashboard</h1>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ flex: 1, minWidth: 200, height: 100, background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5' }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>Dashboard</h1>
          <p style={{ fontSize: 14, color: '#666' }}>Overview of your Get Lucky platform</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        <StatCard
          title="Total Revenue"
          value={formatZAR(stats?.totalRevenue ?? 0)}
          icon={DollarSign}
          accent="#335231"
          subtitle={`${stats?.activeBets ?? 0} bets via PayFast`}
        />
        <StatCard
          title="Active Bets"
          value={String(stats?.activeBets ?? 0)}
          icon={Ticket}
          accent="#1565c0"
        />
        <StatCard
          title="Pending Claims"
          value={String(stats?.pendingClaims ?? 0)}
          icon={ClipboardCheck}
          accent={(stats?.pendingClaims ?? 0) > 0 ? '#c0392b' : '#1a7f37'}
          subtitle={(stats?.pendingClaims ?? 0) > 0 ? 'Requires attention' : 'All clear'}
        />
        <StatCard
          title="Total Payouts"
          value={formatZAR(stats?.totalPayouts ?? 0)}
          icon={Trophy}
          accent="#b8860b"
          subtitle="Processed via PayFast"
        />
        <StatCard
          title="Total Users"
          value={String(stats?.totalUsers ?? 0)}
          icon={Users}
          accent="#4a7a3d"
        />
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
        {(stats?.pendingClaims ?? 0) > 0 && (
          <button
            onClick={() => router.push('/admin/verification-queue')}
            style={{
              flex: 1,
              padding: '16px 20px',
              borderRadius: 12,
              background: '#c0392b',
              border: 'none',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <ClipboardCheck size={20} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Review {stats?.pendingClaims} Pending Claims</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Claims waiting for verification</div>
            </div>
            <ArrowRight size={18} />
          </button>
        )}
        <button
          onClick={() => router.push('/admin/courses/new')}
          style={{
            flex: 1,
            padding: '16px 20px',
            borderRadius: 12,
            background: '#335231',
            border: 'none',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Add Course</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Register a new golf course</div>
          </div>
          <ArrowRight size={18} />
        </button>
        <button
          onClick={async () => {
            const res = await fetch('/api/admin/export', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'bets' }),
            })
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `bets-export-${new Date().toISOString().slice(0, 10)}.csv`
            a.click()
            URL.revokeObjectURL(url)
          }}
          style={{
            flex: 1,
            padding: '16px 20px',
            borderRadius: 12,
            background: '#fff',
            border: '1px solid #e5e5e5',
            color: '#333',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>Export Data</div>
            <div style={{ fontSize: 12, color: '#999' }}>Download bets as CSV</div>
          </div>
          <ArrowRight size={18} color="#999" />
        </button>
      </div>

      {/* Two column: Recent Bets + Recent Claims */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Recent Bets */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>Recent Bets</h3>
            <button
              onClick={() => router.push('/admin/bets')}
              style={{ fontSize: 13, color: '#335231', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
            >
              View all
            </button>
          </div>
          {(stats?.recentBets ?? []).length === 0 ? (
            <p style={{ color: '#999', fontSize: 13 }}>No recent bets</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats?.recentBets.map((bet) => (
                <div
                  key={bet.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', background: '#fafafa', borderRadius: 8, fontSize: 13,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, color: '#111' }}>{bet.userName || 'Unknown'}</div>
                    <div style={{ fontSize: 12, color: '#999' }}>{bet.courseName} · {TIER_LABELS[bet.tier]}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusBadge status={bet.status} small />
                    <span style={{ fontSize: 11, color: '#999' }}>{timeAgo(bet.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Verifications */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>Recent Claims</h3>
            <button
              onClick={() => router.push('/admin/verification-queue')}
              style={{ fontSize: 13, color: '#335231', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
            >
              View queue
            </button>
          </div>
          {(stats?.recentVerifications ?? []).length === 0 ? (
            <p style={{ color: '#999', fontSize: 13 }}>No recent claims</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats?.recentVerifications.map((v) => (
                <div
                  key={v.id}
                  onClick={() => router.push(`/admin/verification-queue/${v.id}`)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', background: '#fafafa', borderRadius: 8, fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, color: '#111' }}>{v.userName || 'Unknown'}</div>
                    <div style={{ fontSize: 12, color: '#999' }}>{v.courseName} · {formatZAR(v.potentialWinCents)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusBadge status={v.status} small />
                    <span style={{ fontSize: 11, color: '#999' }}>{timeAgo(v.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
