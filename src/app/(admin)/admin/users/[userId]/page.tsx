'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Ban, CheckCircle, User, Trophy, Ticket, CreditCard } from 'lucide-react'
import StatCard from '@/components/admin/StatCard'
import StatusBadge from '@/components/admin/StatusBadge'
import ConfirmModal from '@/components/admin/ConfirmModal'
import { formatZAR, timeAgo } from '@/lib/format'
import { TIER_LABELS } from '@/lib/tiers'
import type { AdminUserRecord, AdminBetRecord } from '@/types/admin'

export default function AdminUserDetailPage() {
  const params = useParams()
  const router = useRouter()
  const userId = params.userId as string
  const [user, setUser] = useState<AdminUserRecord | null>(null)
  const [bets, setBets] = useState<AdminBetRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [suspendModal, setSuspendModal] = useState(false)
  const [suspendReason, setSuspendReason] = useState('')

  useEffect(() => {
    fetch(`/api/admin/users/${userId}`)
      .then(r => r.json())
      .then(data => {
        setUser(data.user)
        setBets(data.bets || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [userId])

  const handleToggleSuspend = async () => {
    if (!user) return
    const newSuspended = !user.suspendedAt
    await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suspended: newSuspended, reason: suspendReason }),
    })
    setSuspendModal(false)
    setSuspendReason('')
    // Refresh
    const data = await fetch(`/api/admin/users/${userId}`).then(r => r.json())
    setUser(data.user)
  }

  if (loading) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 70, height: 32, background: '#e5e5e5', borderRadius: 6 }} />
          <div style={{ flex: 1 }}>
            <div style={{ width: '30%', height: 20, background: '#e5e5e5', borderRadius: 4, marginBottom: 8 }} />
            <div style={{ width: '40%', height: 14, background: '#f0f0f0', borderRadius: 4 }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          {[1,2,3,4].map(i => <div key={i} style={{ flex: 1, height: 90, background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5' }} />)}
        </div>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', height: 300 }} />
      </div>
    )
  }

  if (!user) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>User not found</div>
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => router.push('/admin/users')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 6, border: '1px solid #e5e5e5',
            background: '#fff', cursor: 'pointer', color: '#333', fontSize: 13,
          }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111', margin: 0, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>{user.name || 'Unknown User'}{user.isAdmin && <span style={{ fontSize: 12, fontWeight: 600, color: '#335231', background: '#e6f4ea', padding: '2px 8px', borderRadius: 10, marginLeft: 8, verticalAlign: 'middle' }}>Admin</span>}</h1>
          <p style={{ fontSize: 13, color: '#666', margin: 0 }}>{user.email} · Member since {new Date(user.createdAt).toLocaleDateString('en-ZA')}</p>
        </div>
        {user.suspendedAt ? (
          <button
            onClick={() => setSuspendModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              borderRadius: 8, border: 'none', background: '#1a7f37', color: '#fff',
              fontSize: 13, cursor: 'pointer', fontWeight: 600,
            }}
          >
            <CheckCircle size={14} /> Unsuspend
          </button>
        ) : (
          <button
            onClick={() => setSuspendModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              borderRadius: 8, border: 'none', background: '#c0392b', color: '#fff',
              fontSize: 13, cursor: 'pointer', fontWeight: 600,
            }}
          >
            <Ban size={14} /> Suspend User
          </button>
        )}
      </div>

      {/* Suspended banner */}
      {user.suspendedAt && (
        <div
          style={{
            padding: '12px 16px', borderRadius: 8, background: '#fde8e8',
            border: '1px solid #f5c6cb', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <Ban size={16} color="#c0392b" />
          <span style={{ fontSize: 13, color: '#c0392b', fontWeight: 500 }}>
            Suspended: {user.suspendedReason || 'No reason provided'}
          </span>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatCard title="Total Attempts" value={String(user.totalAttempts)} icon={Ticket} accent="#1565c0" />
        <StatCard title="Total Staked" value={formatZAR(user.totalStaked)} icon={CreditCard} accent="#335231" />
        <StatCard title="Total Won" value={user.totalWon > 0 ? formatZAR(user.totalWon) : 'R0'} icon={Trophy} accent="#b8860b" />
        <StatCard title="Handicap" value={user.handicap !== null ? String(user.handicap) : '—'} icon={User} accent="#4a7a3d" />
      </div>

      {/* PayFast payment method */}
      {user.paymentMethod && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderRadius: 10, border: '1px solid #e5e5e5', marginBottom: 24 }}>
          <CreditCard size={18} color="#335231" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
              {user.paymentMethod === 'card' ? 'Credit/Debit Card' : user.paymentMethod === 'eft' ? 'EFT Bank Transfer' : user.paymentMethod === 'apple_pay' ? 'Apple Pay' : user.paymentMethod === 'google_pay' ? 'Google Pay' : user.paymentMethod}
            </div>
            <div style={{ fontSize: 12, color: '#999' }}>Processed via PayFast</div>
          </div>
        </div>
      )}

      {/* Bet history */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e5e5' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>Bet History ({bets.length})</h3>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e5e5', background: '#fafafa' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Course</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Tier</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Stake</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Potential Win</th>
              <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Status</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {bets.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: '#999' }}>No bets</td></tr>
            ) : (
              bets.map((bet) => (
                <tr key={bet.id} className="admin-tr" style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 14px', color: '#111' }}>{bet.courseName}, H{bet.holeNumber}</td>
                  <td style={{ padding: '10px 14px', color: '#335231', fontWeight: 600, fontSize: 12 }}>{TIER_LABELS[bet.tier]}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#111' }}>{formatZAR(bet.stakeCents)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#111' }}>{formatZAR(bet.potentialWinCents)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}><StatusBadge status={bet.status} small /></td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: '#999', fontSize: 12 }}>{timeAgo(bet.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Suspend modal */}
      <ConfirmModal
        open={suspendModal}
        title={user.suspendedAt ? 'Unsuspend User' : 'Suspend User'}
        message={user.suspendedAt
          ? `This will restore ${user.name}'s access to the platform.`
          : `This will prevent ${user.name} from placing new bets or accessing the platform.`}
        confirmLabel={user.suspendedAt ? 'Unsuspend' : 'Suspend'}
        variant={user.suspendedAt ? 'success' : 'danger'}
        onConfirm={handleToggleSuspend}
        onCancel={() => { setSuspendModal(false); setSuspendReason('') }}
      >
        {!user.suspendedAt && (
          <input
            type="text"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="Reason for suspension (optional)"
            style={{
              width: '100%', padding: 10, borderRadius: 8, border: '1px solid #e5e5e5',
              fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif",
            }}
          />
        )}
      </ConfirmModal>
    </div>
  )
}
