'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, AlertTriangle, CreditCard, ExternalLink, ShieldAlert } from 'lucide-react'
import StatusBadge from '@/components/admin/StatusBadge'
import ConfirmModal from '@/components/admin/ConfirmModal'
import LoadError from '@/components/admin/LoadError'
import { formatZAR, timeAgo } from '@/lib/format'
import { TIER_LABELS } from '@/lib/tiers'
import { RULE_LABELS, describeFlag } from '@/lib/risk/labels'
import type { AdminBetDetail } from '@/types/admin'
import { RequestError, getJson, sastDate, sastDateTime } from '../client-helpers'

/** The shortest payout reference PATCH /api/admin/bets/[betId] accepts. */
const MIN_REFERENCE = 3

/** Why the latest load failed: a real 404, or anything else (which is never shown as "not found"). */
type Failure = { notFound: true } | { notFound: false; detail?: string }

/** One labelled value in a card's list. */
function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="adm-small">{name}</dt>
      <dd style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{children}</dd>
    </div>
  )
}

/** A time in South African time, with how long ago. */
function When({ at }: { at: string }) {
  return <time dateTime={at}>{sastDateTime(at)} <span className="adm-small">({timeAgo(at)})</span></time>
}

function BackToBets() {
  return (
    <Link href="/admin/bets" className="adm-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
      <ArrowLeft size={14} aria-hidden /> Bets
    </Link>
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
  const betId = params.betId as string
  // The last bet loaded, and which id it was loaded for.
  const [loadedBet, setLoadedBet] = useState<{ id: string; detail: AdminBetDetail } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<{ key: string; failure: Failure | null } | null>(null)
  const [payoutOpen, setPayoutOpen] = useState(false)
  const [payoutReference, setPayoutReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [payoutError, setPayoutError] = useState<string | null>(null)

  // Loading until the request for this bet (and this attempt) has answered;
  // a slower, older answer is dropped.
  const key = `${betId}#${attempt}`
  const loading = outcome?.key !== key

  useEffect(() => {
    let cancelled = false
    getJson<AdminBetDetail>(`/api/admin/bets/${betId}`)
      .then(detail => {
        if (cancelled) return
        setLoadedBet({ id: betId, detail })
        setOutcome({ key, failure: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const notFound = err instanceof RequestError && err.status === 404
        setOutcome({ key, failure: notFound ? { notFound: true } : { notFound: false, detail: err instanceof Error ? err.message : undefined } })
      })
    return () => { cancelled = true }
  }, [key, betId])

  const reference = payoutReference.trim()

  function closePayout() {
    setPayoutOpen(false)
    setPayoutError(null)
  }

  async function confirmPayout() {
    if (reference.length < MIN_REFERENCE) return
    setSaving(true)
    setPayoutError(null)
    try {
      const res = await fetch(`/api/admin/bets/${betId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid', payoutReference: reference }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setPayoutError(body.error ?? 'The payout could not be recorded. Nothing has changed; please try again.')
        return
      }
      // Recorded: show it at once, so a failed reload cannot leave the payout button up.
      setLoadedBet(b => (b ? { ...b, detail: { ...b.detail, status: 'paid', payoutReference: reference } } : b))
      setPayoutOpen(false)
      setPayoutReference('')
      setAttempt(n => n + 1)
    } catch {
      setPayoutError('The server could not be reached, so the payout may not have been recorded. Reload the page to check before trying again.')
    } finally {
      setSaving(false)
    }
  }

  const bet = loadedBet?.id === betId ? loadedBet.detail : null
  const failure = loading ? null : outcome?.failure ?? null
  const retry = () => setAttempt(n => n + 1)

  if (!bet) {
    return (
      <div style={{ maxWidth: 900 }}>
        <title>Bet · Get Lucky admin</title>
        <BackToBets />
        {failure?.notFound ? (
          <div className="adm-card" style={{ textAlign: 'center', padding: 36 }}>
            <h1 className="adm-h2" style={{ marginBottom: 6 }}>No such bet</h1>
            <p className="adm-muted" style={{ margin: 0 }}>There is no bet with this id. A bet goes when its golfer&rsquo;s account is deleted.</p>
          </div>
        ) : failure ? (
          <LoadError what="The bet" detail={failure.detail} onRetry={retry} />
        ) : (
          <p className="adm-muted">Loading the bet…</p>
        )}
      </div>
    )
  }

  const paidOut = bet.status === 'paid'
  const unmatchedPayment = bet.payment && bet.payment.status !== 'complete'
  const payee = bet.user.name || bet.user.email || 'the golfer'

  return (
    <div style={{ maxWidth: 900 }}>
      <title>{`Bet at ${bet.courseName} · Get Lucky admin`}</title>
      <BackToBets />
      <div className="adm-head">
        <div>
          <h1 className="adm-title">{bet.courseName}, hole {bet.holeNumber}</h1>
          <p className="adm-lead">
            {TIER_LABELS[bet.tier]} · {formatZAR(bet.stakeCents)} to win {formatZAR(bet.potentialWinCents)} · placed <When at={bet.createdAt} />
          </p>
        </div>
        <StatusBadge status={bet.status} />
      </div>

      {failure && (
        <LoadError
          what="The latest version of this bet"
          detail={failure.notFound ? 'There is no longer a bet with this id.' : failure.detail}
          onRetry={retry}
        />
      )}

      {bet.user.suspendedAt && (
        <div role="status" className="adm-card adm-error" style={{ display: 'flex', gap: 10, alignItems: 'center', border: '2px solid #f3c7c7', fontSize: 14 }}>
          <ShieldAlert size={18} aria-hidden /> This golfer&rsquo;s account is suspended.
        </div>
      )}

      {/* ── The golfer ── */}
      <section className="adm-card adm-stack">
        <h2 className="adm-h3">Golfer</h2>
        <dl className="adm-grid-2" style={{ margin: 0 }}>
          <Field name="Name">{bet.user.name || '—'}</Field>
          <Field name="Email">{bet.user.email || '—'}</Field>
          <Field name="Age verified">{bet.user.ageVerifiedAt ? sastDate(bet.user.ageVerifiedAt) : <span className="adm-error">No</span>}</Field>
          <Field name="Total attempts">{bet.user.totalAttempts}</Field>
        </dl>
        <div>
          <Link href={`/admin/users/${bet.user.id}`} className="adm-btn adm-btn--quiet">
            Open golfer <ExternalLink size={13} aria-hidden />
          </Link>
        </div>
      </section>

      {/* ── The money ── */}
      <section className="adm-card adm-stack">
        <h2 className="adm-h3">Payment</h2>
        {bet.payment ? (
          <>
            <dl className="adm-grid-2" style={{ margin: 0 }}>
              <Field name="Amount">{formatZAR(bet.payment.amountCents)}</Field>
              <Field name="Status"><StatusBadge status={bet.payment.status} small variant={bet.payment.status === 'complete' ? 'success' : 'danger'} /></Field>
              <Field name="Paid with">{bet.payment.source === 'saved_card' ? 'Saved card' : 'Checkout'}</Field>
              <Field name="Taken"><When at={bet.payment.createdAt} /></Field>
              <Field name="Our reference"><span className="adm-mono">{bet.payment.mPaymentId}</span></Field>
              <Field name="PayFast reference"><span className="adm-mono">{bet.payment.pfPaymentId || '—'}</span></Field>
            </dl>
            {unmatchedPayment && (
              <p className="adm-warn" style={{ margin: 0 }}>
                <AlertTriangle size={14} aria-hidden /> This bet exists but its payment is not complete. Check PayFast before treating it as paid.
              </p>
            )}
          </>
        ) : (
          <p className="adm-warn" style={{ margin: 0 }}>
            <AlertTriangle size={14} aria-hidden /> No payment on record for this bet. Reference: <span className="adm-mono">{bet.paymentIntentId || 'none'}</span>
          </p>
        )}
      </section>

      {/* ── The shot ── */}
      <section className="adm-card adm-stack">
        <h2 className="adm-h3">The shot</h2>
        <dl className="adm-grid-2" style={{ margin: 0 }}>
          <Field name="Declared">{bet.declaredResult ? <StatusBadge status={bet.declaredResult === 'win' ? 'claimed' : 'miss'} small /> : 'Not yet'}</Field>
          <Field name="Declared at">{bet.declaredAt ? <When at={bet.declaredAt} /> : '—'}</Field>
          <Field name="Play window ends">{bet.expiresAt ? sastDateTime(bet.expiresAt) : '—'}</Field>
          <Field name="Footage">{bet.videoUploadedAt ? <When at={bet.videoUploadedAt} /> : 'None'}</Field>
        </dl>
        {bet.videoSignedUrl ? (
          <video src={bet.videoSignedUrl} controls preload="metadata" style={{ width: '100%', maxWidth: 420, borderRadius: 10, background: '#000' }} />
        ) : (
          <p className="adm-muted" style={{ margin: 0 }}>No footage uploaded.</p>
        )}
        {bet.videoSha256 && (
          <dl style={{ margin: 0 }}>
            <Field name="Footage fingerprint (SHA-256)"><span className="adm-mono">{bet.videoSha256}</span></Field>
          </dl>
        )}
      </section>

      {/* ── Risk ── */}
      {bet.riskFlags.length > 0 && (
        <section className="adm-card adm-stack">
          <h2 className="adm-h3">Risk · score {bet.riskScore}</h2>
          {bet.riskFlags.map((flag, i) => (
            <div key={`${flag.rule}-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <StatusBadge status={flag.severity} small variant={flag.severity === 'high' ? 'danger' : flag.severity === 'medium' ? 'warning' : 'neutral'} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{RULE_LABELS[flag.rule]?.label ?? flag.rule}</div>
                <div className="adm-small">{describeFlag(flag)}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── The claim ── */}
      {bet.verificationId && (
        <section className="adm-card adm-stack">
          <h2 className="adm-h3">Claim</h2>
          <div className="adm-row" style={{ alignItems: 'center' }}>
            <StatusBadge status={bet.verificationStatus ?? 'pending'} />
            <Link href={`/admin/verification-queue/${bet.verificationId}`} className="adm-btn adm-btn--quiet">
              Open the review <ExternalLink size={13} aria-hidden />
            </Link>
          </div>
        </section>
      )}

      {/* ── Payout ── */}
      {(bet.status === 'verified' || paidOut) && (
        <section className="adm-card adm-stack">
          <h2 className="adm-h3">Payout</h2>
          {paidOut ? (
            <dl className="adm-grid-2" style={{ margin: 0 }}>
              <Field name="Prize">{formatZAR(bet.potentialWinCents)}</Field>
              <Field name="Reference"><span className="adm-mono">{bet.payoutReference || '—'}</span></Field>
            </dl>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
                The claim is verified: <strong>{formatZAR(bet.potentialWinCents)}</strong> is owed to <strong>{payee}</strong>.
                Record the payout once the money has left the account; the reference is kept with the bet.
              </p>
              <div>
                <button type="button" onClick={() => setPayoutOpen(true)} className="adm-btn">
                  <CreditCard size={17} aria-hidden /> Confirm payout
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {/* ── Audit trail ── */}
      <section className="adm-card adm-stack">
        <h2 className="adm-h3">History</h2>
        {bet.events.length === 0 ? (
          <p className="adm-muted" style={{ margin: 0 }}>Nothing recorded yet.</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr><th>When (SA time)</th><th>By</th><th>Change</th></tr>
              </thead>
              <tbody>
                {bet.events.map(event => (
                  <tr key={event.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{sastDateTime(event.created_at)}</td>
                    <td className="adm-muted">{event.actor_role}</td>
                    <td>
                      {event.changed
                        ? Object.entries(event.changed).map(([field, change]) => (
                            <div key={field}>
                              {field}: {String(change.from ?? '—')} → <strong>{String(change.to ?? '—')}</strong>
                            </div>
                          ))
                        : `${event.table_name} ${event.action}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmModal
        open={payoutOpen}
        title="Confirm the prize was paid"
        message={`Only confirm once ${formatZAR(bet.potentialWinCents)} has left the account for ${payee}. This marks the bet as paid, puts it on the winners list, and records your admin id in its history.`}
        confirmLabel="Yes, the prize was paid"
        variant="success"
        busy={saving}
        confirmDisabled={reference.length < MIN_REFERENCE}
        error={payoutError}
        onConfirm={confirmPayout}
        onCancel={closePayout}
      >
        <div className="adm-stack">
          <dl className="adm-grid-2" style={{ margin: 0 }}>
            <Field name="Prize">{formatZAR(bet.potentialWinCents)}</Field>
            <Field name="Paid to">
              {bet.user.name || '—'}
              <div className="adm-small" style={{ fontWeight: 400 }}>{bet.user.email || 'No email on record'}</div>
            </Field>
          </dl>
          <label className="adm-field">
            Bank or PayFast reference
            <input
              value={payoutReference}
              onChange={e => setPayoutReference(e.target.value)}
              placeholder="e.g. FNB-2026-09-15-0042"
              maxLength={120}
              autoComplete="off"
              disabled={saving}
              className="adm-input"
            />
            <span className="adm-hint">At least {MIN_REFERENCE} characters, as it appears on the transfer.</span>
          </label>
        </div>
      </ConfirmModal>
    </div>
  )
}
