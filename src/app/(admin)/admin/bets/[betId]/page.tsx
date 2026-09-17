'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, AlertTriangle, CreditCard, ExternalLink, ShieldAlert } from 'lucide-react'
import StatusBadge from '@/components/admin/StatusBadge'
import ConfirmModal from '@/components/admin/ConfirmModal'
import { formatZAR, timeAgo } from '@/lib/format'
import { TIER_LABELS } from '@/lib/tiers'
import { RULE_LABELS, describeFlag } from '@/lib/risk/labels'
import type { AdminBetDetail } from '@/types/admin'

const card: React.CSSProperties = { background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 18, marginBottom: 16 }
const h2: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }
const label: React.CSSProperties = { fontSize: 12, color: '#888', marginBottom: 2 }
const value: React.CSSProperties = { fontSize: 14, color: '#111', fontWeight: 500 }
const mono: React.CSSProperties = { fontFamily: "'Space Mono', ui-monospace, monospace", fontSize: 12, color: '#333', wordBreak: 'break-all' }

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={label}>{name}</div>
      <div style={value}>{children}</div>
    </div>
  )
}

/**
 * One bet, with the money, the footage and the audit trail beside it.
 *
 * Read-mostly: the only change an admin makes here is confirming a payout
 * (verified → paid, with the bank reference). Results are declared by the
 * player and approval goes through the verification queue, which the state
 * machine enforces server-side regardless of what this screen offers.
 */
export default function AdminBetDetailPage() {
  const params = useParams()
  const router = useRouter()
  const betId = params.betId as string
  const [bet, setBet] = useState<AdminBetDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [payoutModal, setPayoutModal] = useState(false)
  const [payoutReference, setPayoutReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    return fetch(`/api/admin/bets/${betId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: AdminBetDetail) => setBet(data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [betId])

  useEffect(() => { load() }, [load])

  async function confirmPayout() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/bets/${betId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid', payoutReference }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Could not record the payout.')
      }
      setPayoutModal(false)
      setPayoutReference('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the payout.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div>
        <div style={{ width: 200, height: 24, background: '#e5e5e5', borderRadius: 6, marginBottom: 24 }} />
        {[1, 2, 3].map(i => <div key={i} style={{ ...card, height: 140 }} />)}
      </div>
    )
  }
  if (notFound || !bet) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Bet not found</div>
  }

  const paidOut = bet.status === 'paid'
  const unmatchedPayment = bet.payment && bet.payment.status !== 'complete'

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => router.push('/admin/bets')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer', color: '#333', fontSize: 13 }}
        >
          <ArrowLeft size={14} /> Bets
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111', fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>
            {bet.courseName}, Hole {bet.holeNumber}
          </h1>
          <div style={{ fontSize: 13, color: '#666' }}>
            {TIER_LABELS[bet.tier]} · {formatZAR(bet.stakeCents)} to win {formatZAR(bet.potentialWinCents)} · {timeAgo(bet.createdAt)}
          </div>
        </div>
        <StatusBadge status={bet.status} />
      </div>

      {bet.user.suspendedAt && (
        <div style={{ ...card, background: '#fde8e8', borderColor: '#f5c6c6', display: 'flex', gap: 10, alignItems: 'center' }}>
          <ShieldAlert size={18} color="#c0392b" />
          <span style={{ fontSize: 13, color: '#c0392b' }}>This golfer&apos;s account is suspended.</span>
        </div>
      )}

      {/* ── The golfer ── */}
      <div style={card}>
        <div style={h2}>Golfer</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
          <Field name="Name">{bet.user.name || '—'}</Field>
          <Field name="Email">{bet.user.email || '—'}</Field>
          <Field name="Age verified">{bet.user.ageVerifiedAt ? new Date(bet.user.ageVerifiedAt).toLocaleDateString('en-ZA') : <span style={{ color: '#c0392b' }}>No</span>}</Field>
          <Field name="Total attempts">{bet.user.totalAttempts}</Field>
        </div>
        <button
          onClick={() => router.push(`/admin/users/${bet.user.id}`)}
          style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer', color: '#333', fontSize: 13 }}
        >
          Open golfer <ExternalLink size={13} />
        </button>
      </div>

      {/* ── The money ── */}
      <div style={card}>
        <div style={h2}>Payment</div>
        {bet.payment ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
              <Field name="Amount">{formatZAR(bet.payment.amountCents)}</Field>
              <Field name="Status"><StatusBadge status={bet.payment.status} small variant={bet.payment.status === 'complete' ? 'success' : 'danger'} /></Field>
              <Field name="Paid with">{bet.payment.source === 'saved_card' ? 'Saved card' : 'Checkout'}</Field>
              <Field name="Taken">{timeAgo(bet.payment.createdAt)}</Field>
            </div>
            <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
              <div><div style={label}>Our reference</div><div style={mono}>{bet.payment.mPaymentId}</div></div>
              <div><div style={label}>PayFast reference</div><div style={mono}>{bet.payment.pfPaymentId || '—'}</div></div>
            </div>
            {unmatchedPayment && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: '#fff8e1', color: '#a07820', fontSize: 13, display: 'flex', gap: 8 }}>
                <AlertTriangle size={16} />
                This bet exists but its payment is not complete. Check PayFast before treating it as paid.
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13, color: '#a07820', display: 'flex', gap: 8, alignItems: 'center' }}>
            <AlertTriangle size={16} />
            No payment on record for this bet. Reference: <span style={mono}>{bet.paymentIntentId || 'none'}</span>
          </div>
        )}
      </div>

      {/* ── The shot ── */}
      <div style={card}>
        <div style={h2}>The shot</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 14 }}>
          <Field name="Declared">{bet.declaredResult ? <StatusBadge status={bet.declaredResult === 'win' ? 'claimed' : 'miss'} small /> : 'Not yet'}</Field>
          <Field name="Declared at">{bet.declaredAt ? timeAgo(bet.declaredAt) : '—'}</Field>
          <Field name="Play window ends">{bet.expiresAt ? new Date(bet.expiresAt).toLocaleString('en-ZA') : '—'}</Field>
          <Field name="Footage">{bet.videoUploadedAt ? timeAgo(bet.videoUploadedAt) : 'None'}</Field>
        </div>
        {bet.videoSignedUrl ? (
          <video src={bet.videoSignedUrl} controls preload="metadata" style={{ width: '100%', maxWidth: 420, borderRadius: 10, background: '#000' }} />
        ) : (
          <div style={{ fontSize: 13, color: '#999' }}>No footage uploaded.</div>
        )}
        {bet.videoSha256 && (
          <div style={{ marginTop: 10 }}>
            <div style={label}>Footage fingerprint (SHA-256)</div>
            <div style={mono}>{bet.videoSha256}</div>
          </div>
        )}
      </div>

      {/* ── Risk ── */}
      {bet.riskFlags.length > 0 && (
        <div style={card}>
          <div style={h2}>Risk · score {bet.riskScore}</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {bet.riskFlags.map((flag, i) => (
              <div key={`${flag.rule}-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <StatusBadge status={flag.severity} small variant={flag.severity === 'high' ? 'danger' : flag.severity === 'medium' ? 'warning' : 'neutral'} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{RULE_LABELS[flag.rule]?.label ?? flag.rule}</div>
                  <div style={{ fontSize: 12, color: '#666' }}>{describeFlag(flag)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── The claim ── */}
      {bet.verificationId && (
        <div style={card}>
          <div style={h2}>Claim</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StatusBadge status={bet.verificationStatus ?? 'pending'} />
            <button
              onClick={() => router.push(`/admin/verification-queue/${bet.verificationId}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer', color: '#333', fontSize: 13 }}
            >
              Open the review <ExternalLink size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Payout ── */}
      {(bet.status === 'verified' || paidOut) && (
        <div style={card}>
          <div style={h2}>Payout</div>
          {paidOut ? (
            <Field name="Reference"><span style={mono}>{bet.payoutReference || '—'}</span></Field>
          ) : (
            <>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
                This claim is verified. Record the payout once the money has left the account; the reference is kept with the bet.
              </p>
              <button
                onClick={() => setPayoutModal(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#335231', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                <CreditCard size={14} /> Confirm payout
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Audit trail ── */}
      <div style={card}>
        <div style={h2}>History</div>
        {bet.events.length === 0 ? (
          <div style={{ fontSize: 13, color: '#999' }}>Nothing recorded yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {bet.events.map(event => (
              <div key={event.id} style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                <div style={{ color: '#999', minWidth: 110 }}>{new Date(event.created_at).toLocaleString('en-ZA')}</div>
                <div style={{ color: '#666', minWidth: 70 }}>{event.actor_role}</div>
                <div style={{ color: '#111' }}>
                  {event.changed
                    ? Object.entries(event.changed).map(([field, change]) => (
                        <div key={field}>
                          {field}: {String(change.from ?? '—')} → <strong>{String(change.to ?? '—')}</strong>
                        </div>
                      ))
                    : `${event.table_name} ${event.action}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        open={payoutModal}
        title="Confirm payout"
        message="Record this claim as paid. Enter the bank or PayFast reference for the transfer."
        confirmLabel={saving ? 'Saving…' : 'Mark as paid'}
        onConfirm={confirmPayout}
        onCancel={() => { setPayoutModal(false); setError('') }}
      >
        <input
          value={payoutReference}
          onChange={e => setPayoutReference(e.target.value)}
          placeholder="Payment reference"
          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 14, color: '#111' }}
        />
        {error && <div style={{ marginTop: 10, fontSize: 13, color: '#c0392b' }}>{error}</div>}
      </ConfirmModal>
    </div>
  )
}
