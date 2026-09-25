'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Ban, CheckCircle, CreditCard, Ticket, Trophy, User } from 'lucide-react'
import StatCard from '@/components/admin/StatCard'
import StatusBadge from '@/components/admin/StatusBadge'
import ConfirmModal from '@/components/admin/ConfirmModal'
import LoadError from '@/components/admin/LoadError'
import Pagination from '@/components/admin/Pagination'
import { formatZAR } from '@/lib/format'
import { TIER_LABELS } from '@/lib/tiers'
import type { AdminUserRecord, AdminBetRecord, AdminPaymentRecord } from '@/types/admin'
import { sastDate, sastDateTime } from '../../bets/client-helpers'

/** A bet in the golfer's history, with the claim it made when they declared a hole-in-one. */
type UserBet = AdminBetRecord & { claim: { id: string; status: string } | null }

interface Detail {
  user: AdminUserRecord
  bets: UserBet[]
  betsTotal: number
  betsPage: number
  betsPerPage: number
  payments: AdminPaymentRecord[]
}

const OFFLINE = 'Could not reach the server. Check your connection and try again.'

const PAYMENT_METHODS: Record<string, string> = { card: 'Credit or debit card', eft: 'EFT bank transfer', apple_pay: 'Apple Pay', google_pay: 'Google Pay' }

export default function AdminUserDetailPage() {
  const params = useParams()
  const userId = params.userId as string
  const [betsPage, setBetsPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loadError, setLoadError] = useState<{ notFound: boolean; detail: string | null } | null>(null)
  // Loading is derived from the request the page is showing, not set in the effect.
  const requestKey = `${userId}:${betsPage}:${attempt}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== requestKey

  const [suspendModal, setSuspendModal] = useState(false)
  const [suspendReason, setSuspendReason] = useState('')
  const [suspendBusy, setSuspendBusy] = useState(false)
  const [suspendError, setSuspendError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/users/${userId}?betsPage=${betsPage}`)
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) { setLoadError({ notFound: res.status === 404, detail: json.error ?? null }); return }
        setLoadError(null)
        setDetail(json as Detail)
      })
      .catch(() => { if (!cancelled) setLoadError({ notFound: false, detail: OFFLINE }) })
      .finally(() => { if (!cancelled) setLoadedKey(`${userId}:${betsPage}:${attempt}`) })
    return () => { cancelled = true }
  }, [userId, betsPage, attempt])

  const closeSuspend = () => { setSuspendModal(false); setSuspendReason(''); setSuspendError(null) }

  const handleToggleSuspend = async () => {
    if (!detail) return
    setSuspendBusy(true)
    setSuspendError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended: !detail.user.suspendedAt, reason: suspendReason.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setSuspendError(json.error ?? 'That did not work. Please try again.'); return }
      closeSuspend()
      setAttempt(n => n + 1)
    } catch {
      setSuspendError(OFFLINE)
    } finally {
      setSuspendBusy(false)
    }
  }

  if (loadError?.notFound) {
    return (
      <div className="adm-card" style={{ textAlign: 'center', padding: 36 }}>
        <title>User not found · Get Lucky admin</title>
        <p className="adm-h2" style={{ marginBottom: 8 }}>User not found</p>
        <p className="adm-muted" style={{ margin: '0 0 16px' }}>They may have deleted their account.</p>
        <Link href="/admin/users" className="adm-btn adm-btn--quiet" style={{ textDecoration: 'none' }}>Back to Users</Link>
      </div>
    )
  }
  if (loadError && !loading) return <LoadError what="This golfer" detail={loadError.detail} onRetry={() => setAttempt(n => n + 1)} />
  if (!detail) return <p className="adm-muted">Loading…</p>

  const { user, bets, payments, betsTotal, betsPerPage } = detail
  const name = user.name || 'No name'

  return (
    <div>
      <title>{`${name} · Users · Get Lucky admin`}</title>
      <Link href="/admin/users" className="adm-btn adm-btn--quiet" style={{ textDecoration: 'none', marginBottom: 18 }}>
        <ArrowLeft size={15} aria-hidden /> Users
      </Link>
      <div className="adm-head">
        <div>
          <h1 className="adm-title">
            {name}
            {user.isAdmin && <span className="adm-pill adm-pill--gold" style={{ marginLeft: 12, verticalAlign: 'middle' }}>Admin</span>}
          </h1>
          <p className="adm-lead">
            {user.email} · joined {sastDate(user.createdAt)}
            {user.paymentMethod && ` · pays by ${PAYMENT_METHODS[user.paymentMethod] ?? user.paymentMethod} through PayFast`}
          </p>
        </div>
        {user.suspendedAt ? (
          <button type="button" onClick={() => setSuspendModal(true)} className="adm-btn adm-btn--green">
            <CheckCircle size={14} aria-hidden /> Lift suspension
          </button>
        ) : (
          <button type="button" onClick={() => setSuspendModal(true)} className="adm-btn adm-btn--quiet adm-btn--danger">
            <Ban size={14} aria-hidden /> Suspend
          </button>
        )}
      </div>

      {user.suspendedAt && (
        <p role="status" className="adm-card" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 16px', border: '2px solid #f3c7c7', color: 'var(--red)', fontWeight: 600, fontSize: 14 }}>
          <Ban size={16} aria-hidden /> Suspended {sastDate(user.suspendedAt)}: {user.suspendedReason || 'no reason given'}
        </p>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard title="Attempts" value={String(user.totalAttempts)} icon={Ticket} />
        <StatCard title="Staked" value={formatZAR(user.totalStaked)} icon={CreditCard} subtitle={`Over all ${betsTotal.toLocaleString('en-ZA')} bet${betsTotal === 1 ? '' : 's'}`} />
        <StatCard title="Won" value={formatZAR(user.totalWon)} icon={Trophy} subtitle="Verified and paid prizes" />
        <StatCard title="Handicap" value={user.handicap !== null ? String(user.handicap) : '—'} icon={User} />
      </div>

      {/* Age check and saved card: the two things support is asked about */}
      <div className="adm-grid-2" style={{ marginBottom: 16 }}>
        <div className="adm-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user.ageVerifiedAt
            ? <CheckCircle size={20} aria-hidden />
            : <AlertTriangle size={20} aria-hidden style={{ color: 'var(--red)' }} />}
          <div>
            <div className="adm-h3">{user.ageVerifiedAt ? 'Age verified' : 'Age not verified'}</div>
            <div className="adm-small">
              {user.ageVerifiedAt ? sastDate(user.ageVerifiedAt) : 'No bet can be granted until this passes'}
            </div>
          </div>
        </div>
        <div className="adm-card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 0 }}>
          <CreditCard size={20} aria-hidden />
          <div>
            <div className="adm-h3">{user.savedCard ? user.savedCard.label : 'No saved card'}</div>
            <div className="adm-small">
              {user.savedCard
                ? `Saved ${sastDate(user.savedCard.savedAt)}${user.savedCard.lastUsedAt ? `, last used ${sastDateTime(user.savedCard.lastUsedAt)}` : ''} · held by PayFast`
                : 'The golfer adds or removes one under Account'}
            </div>
          </div>
        </div>
      </div>

      <section className="adm-card">
        <h2 className="adm-h2">Bets</h2>
        <p className="adm-small" style={{ margin: '6px 0 12px' }}>
          {betsTotal === 0 ? 'None yet.' : `${betsTotal.toLocaleString('en-ZA')} in all, newest first, ${betsPerPage} a page.`}
        </p>
        {bets.length > 0 && (
          <div className="adm-table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Course and hole</th>
                  <th>Tier</th>
                  <th className="adm-num">Stake</th>
                  <th className="adm-num">Prize</th>
                  <th>Status</th>
                  <th>Claim</th>
                  <th className="adm-num">Date</th>
                </tr>
              </thead>
              <tbody>
                {bets.map((bet) => (
                  <tr key={bet.id}>
                    <td><Link href={`/admin/bets/${bet.id}`} className="adm-row-link">{bet.courseName || 'Unknown course'}, hole {bet.holeNumber || '?'}</Link></td>
                    <td>{TIER_LABELS[bet.tier] ?? bet.tier}</td>
                    <td className="adm-num">{formatZAR(bet.stakeCents)}</td>
                    <td className="adm-num" style={{ fontWeight: 600 }}>{formatZAR(bet.potentialWinCents)}</td>
                    <td><StatusBadge status={bet.status} small /></td>
                    <td>
                      {bet.claim
                        ? <Link href={`/admin/verification-queue/${bet.claim.id}`} aria-label={`Open the claim (${bet.claim.status.replace(/_/g, ' ')})`} style={{ textDecoration: 'none' }}><StatusBadge status={bet.claim.status} small /></Link>
                        : <span className="adm-muted">—</span>}
                    </td>
                    <td className="adm-num adm-muted">{sastDateTime(bet.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={betsPage} totalPages={Math.ceil(betsTotal / betsPerPage)} total={betsTotal} onPageChange={setBetsPage} />
      </section>

      <section className="adm-card">
        <h2 className="adm-h2">Payments</h2>
        <p className="adm-small" style={{ margin: '6px 0 12px' }}>
          {payments.length === 0 ? 'None yet.' : payments.length >= 50 ? 'The latest 50, newest first.' : 'Newest first.'} A completed payment with no bet is money taken for nothing: it needs a person.
        </p>
        {payments.length > 0 && (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Course and hole</th>
                  <th className="adm-num">Amount</th>
                  <th>Status</th>
                  <th>Paid with</th>
                  <th>Bet</th>
                  <th className="adm-num">Date</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => {
                  const needsAttention = payment.status === 'complete' && !payment.betId
                  return (
                    <tr key={payment.mPaymentId} className={needsAttention ? 'adm-attention' : undefined}>
                      <td>{payment.courseName ? `${payment.courseName}${payment.holeNumber ? `, hole ${payment.holeNumber}` : ''}` : '—'}</td>
                      <td className="adm-num">{formatZAR(payment.amountCents)}</td>
                      <td>
                        <StatusBadge status={payment.status} small variant={payment.status === 'complete' ? 'success' : payment.status === 'pending' ? 'warning' : 'danger'} />
                      </td>
                      <td>{payment.source === 'saved_card' ? 'Saved card' : 'Checkout'}</td>
                      <td>
                        {payment.betId ? (
                          <Link href={`/admin/bets/${payment.betId}`} className="adm-row-link">Open bet</Link>
                        ) : needsAttention ? (
                          <span className="adm-warn"><AlertTriangle size={13} aria-hidden /> None</span>
                        ) : (
                          <span className="adm-muted">—</span>
                        )}
                      </td>
                      <td className="adm-num adm-muted">{sastDateTime(payment.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmModal
        open={suspendModal}
        title={user.suspendedAt ? `Lift ${name}'s suspension?` : `Suspend ${name}?`}
        message={user.suspendedAt
          ? 'They can sign in and play again straight away.'
          : 'They cannot place new bets or use the app until you lift it. Bets and claims already made carry on.'}
        confirmLabel={user.suspendedAt ? 'Lift suspension' : 'Suspend'}
        variant={user.suspendedAt ? 'success' : 'danger'}
        onConfirm={handleToggleSuspend}
        onCancel={closeSuspend}
        busy={suspendBusy}
        error={suspendError}
      >
        {!user.suspendedAt && (
          <label className="adm-field">
            Reason <span className="adm-hint">optional, kept on their record</span>
            <input
              type="text"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              maxLength={500}
              placeholder="Chargeback on 12 Sep"
              className="adm-input"
            />
          </label>
        )}
      </ConfirmModal>
    </div>
  )
}
