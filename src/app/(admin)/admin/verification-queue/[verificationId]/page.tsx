'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle, XCircle, Clock, User, MapPin, Trophy } from 'lucide-react'
import StatusBadge from '@/components/admin/StatusBadge'
import VideoPlayer from '@/components/admin/VideoPlayer'
import DocumentViewer from '@/components/admin/DocumentViewer'
import ConfirmModal from '@/components/admin/ConfirmModal'
import { formatZAR, timeAgo } from '@/lib/format'
import { TIER_LABELS } from '@/lib/tiers'
import type { VerificationDetail } from '@/types/admin'
import { REVIEW_CHECKLIST, MIN_DECISION_NOTES } from '@/lib/claims/checklist'
import { RULE_LABELS, describeFlag } from '@/lib/risk/labels'

const TIMELINE_STAGES = [
  { key: 'pending', label: 'Claim Submitted', icon: Clock },
  { key: 'documents_received', label: 'Documents Received', icon: Clock },
  { key: 'under_review', label: 'Under Review', icon: Clock },
  { key: 'approved', label: 'Approved', icon: CheckCircle },
]

const STATUS_ORDER = ['pending', 'documents_received', 'under_review', 'approved']

export default function VerificationDetailPage() {
  const params = useParams()
  const router = useRouter()
  const verificationId = params.verificationId as string
  const [detail, setDetail] = useState<VerificationDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState('')
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | 'pay' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [payoutError, setPayoutError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [payoutReference, setPayoutReference] = useState('')
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const checklistComplete = REVIEW_CHECKLIST.every(i => checklist[i.key])
  const notesOk = notes.trim().length >= MIN_DECISION_NOTES

  const confirmPayout = async () => {
    if (!detail) return
    setSubmitting(true)
    setPayoutError(null)
    try {
      const res = await fetch(`/api/admin/bets/${detail.betId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid', payoutReference: payoutReference.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setPayoutError(body.error ?? 'Could not confirm the payout')
      } else {
        const data = await fetch(`/api/admin/verifications/${verificationId}`).then(r => r.json())
        setDetail(data)
      }
    } catch (err) {
      console.error('[admin] payout request failed:', err)
      setPayoutError('Could not confirm the payout')
    } finally {
      setSubmitting(false)
      setConfirmAction(null)
    }
  }

  useEffect(() => {
    fetch(`/api/admin/verifications/${verificationId}`)
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.json() })
      .then(data => {
        setDetail(data)
        setNotes(data.reviewerNotes || '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [verificationId])

  const handleAction = async (action: 'approve' | 'reject' | 'under_review') => {
    setSubmitting(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/admin/verifications/${verificationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'under_review',
          reviewerNotes: notes,
          ...(action === 'approve' ? { checklist } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setActionError(body.error ?? 'The review could not be saved')
      }
      if (res.ok) {
        setConfirmAction(null)
        // Refresh data
        const data = await fetch(`/api/admin/verifications/${verificationId}`).then(r => r.json())
        setDetail(data)
      }
    } catch (err) {
      console.error('[admin] review request failed:', err)
      // error
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 70, height: 32, background: '#e5e5e5', borderRadius: 6 }} />
          <div style={{ flex: 1 }}>
            <div style={{ width: '40%', height: 20, background: '#e5e5e5', borderRadius: 4, marginBottom: 8 }} />
            <div style={{ width: '25%', height: 14, background: '#f0f0f0', borderRadius: 4 }} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
              <div style={{ width: '30%', height: 14, background: '#f0f0f0', borderRadius: 4, marginBottom: 12 }} />
              <div style={{ width: '100%', aspectRatio: '9/16', maxHeight: 300, background: '#f0f0f0', borderRadius: 12 }} />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20, height: 200 }}>
              <div style={{ width: '30%', height: 14, background: '#f0f0f0', borderRadius: 4, marginBottom: 16 }} />
              {[1,2,3].map(i => <div key={i} style={{ width: '80%', height: 14, background: '#f0f0f0', borderRadius: 4, marginBottom: 12 }} />)}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
        Claim not found.
        <button
          onClick={() => router.push('/admin/verification-queue')}
          style={{ display: 'block', margin: '16px auto', color: '#335231', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
        >
          Back to queue
        </button>
      </div>
    )
  }

  const currentStageIdx = STATUS_ORDER.indexOf(detail.status)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => router.push('/admin/verification-queue')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 6, border: '1px solid #e5e5e5',
            background: '#fff', cursor: 'pointer', color: '#333', fontSize: 13,
          }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 2 }}>
            <span style={{ cursor: 'pointer', color: '#335231' }} onClick={() => router.push('/admin/verification-queue')}>Verification Queue</span>
            <span style={{ margin: '0 6px' }}>/</span>
            <span>Claim Review</span>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111', margin: 0, fontFamily: "'Poster Gothic', Georgia, sans-serif" }}>
            Claim Review — {detail.userName || 'Unknown'}
          </h1>
          <p style={{ fontSize: 13, color: '#666', margin: 0 }}>
            {detail.courseName}, Hole {detail.holeNumber} · {TIER_LABELS[detail.tier] || detail.tier}
          </p>
        </div>
        <StatusBadge status={detail.status} />
      </div>

      {/* Split pane layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
        {/* LEFT: Evidence */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Video */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 12 }}>Shot Footage</h3>
            <VideoPlayer src={detail.videoSignedUrl} />
          </div>

          {/* Documents */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 12 }}>Supporting Documents</h3>
            <DocumentViewer
              certificateUrl={detail.certificateSignedUrl}
              affidavitUrl={detail.affidavitSignedUrl}
            />
          </div>
        </div>

        {/* RIGHT: Details + Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Claim info */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 16 }}>Claim Details</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <User size={16} color="#666" />
                <div>
                  <div style={{ fontSize: 13, color: '#999' }}>Claimant</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{detail.userName || 'Unknown'}</div>
                  <button
                    onClick={() => router.push(`/admin/users/${detail.userId}`)}
                    style={{ fontSize: 12, color: '#335231', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                  >
                    View profile
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <MapPin size={16} color="#666" />
                <div>
                  <div style={{ fontSize: 13, color: '#999' }}>Course</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{detail.courseName}, Hole {detail.holeNumber}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Trophy size={16} color="#666" />
                <div>
                  <div style={{ fontSize: 13, color: '#999' }}>Potential Payout</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#335231' }}>{formatZAR(detail.potentialWinCents)}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>Stake: {formatZAR(detail.stakeCents)}</div>
                </div>
              </div>
              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 14 }}>
                <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>Claimed: {detail.declaredAt ? new Date(detail.declaredAt).toLocaleString('en-ZA') : '—'}</div>
                <div style={{ fontSize: 12, color: '#999' }}>Submitted: {timeAgo(detail.createdAt)}</div>
              </div>
            </div>
          </div>

          {/* Evidence integrity */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 12 }}>Evidence Integrity</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: '#666' }}>
              <div>Bet opened: <strong style={{ color: '#111' }}>{detail.betCreatedAt ? new Date(detail.betCreatedAt).toLocaleString('en-ZA') : '—'}</strong></div>
              <div>Play window closed: <strong style={{ color: '#111' }}>{detail.betExpiresAt ? new Date(detail.betExpiresAt).toLocaleString('en-ZA') : '—'}</strong></div>
              <div>
                Footage sealed: {detail.videoUploadedAt
                  ? <strong style={{ color: '#111' }}>{new Date(detail.videoUploadedAt).toLocaleString('en-ZA')}{detail.betExpiresAt && detail.videoUploadedAt > detail.betExpiresAt ? ' (after window!)' : ''}</strong>
                  : <strong style={{ color: '#c0392b' }}>not recorded — footage was never sealed by the server</strong>}
              </div>
              <div>Footage size: <strong style={{ color: '#111' }}>{detail.videoBytes ? `${(detail.videoBytes / 1_000_000).toFixed(1)} MB` : '—'}</strong></div>
              <div style={{ wordBreak: 'break-all' }}>SHA-256: <code style={{ fontSize: 11, color: '#111' }}>{detail.videoSha256 ?? '—'}</code></div>

              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8, marginTop: 4, fontWeight: 600, color: '#111' }}>Recorder report</div>
              {detail.capture.startedAt ? (
                <>
                  <div>Recording: <strong style={{ color: '#111' }}>{new Date(detail.capture.startedAt).toLocaleString('en-ZA')}</strong>{detail.capture.durationMs != null && <> for <strong style={{ color: '#111' }}>{Math.round(detail.capture.durationMs / 1000)} s</strong></>}</div>
                  <div>
                    Sealed after: {detail.capture.uploadLagS != null
                      ? <strong style={{ color: detail.capture.uploadLagS > 15 * 60 ? '#c0392b' : '#111' }}>{detail.capture.uploadLagS < 120 ? `${detail.capture.uploadLagS} s` : `${Math.round(detail.capture.uploadLagS / 60)} min`}{detail.capture.uploadLagS > 15 * 60 ? ' (long gap between recording and upload)' : ''}</strong>
                      : <strong style={{ color: '#111' }}>—</strong>}
                  </div>
                </>
              ) : (
                <div><strong style={{ color: '#c0392b' }}>No recorder timestamps</strong> (older app, or the report failed its sanity checks)</div>
              )}
              <div>
                Location: {detail.capture.lat != null && detail.capture.lng != null ? (
                  <strong style={{ color: detail.capture.distanceM != null && detail.capture.distanceM > 2000 ? '#c0392b' : '#111' }}>
                    {detail.capture.distanceM != null
                      ? `${detail.capture.distanceM < 1000 ? `${detail.capture.distanceM} m` : `${(detail.capture.distanceM / 1000).toFixed(1)} km`} from the course`
                      : 'recorded; course has no coordinates'}
                    {detail.capture.accuracyM != null ? ` (±${detail.capture.accuracyM} m)` : ''}
                    {' '}<a href={`https://www.google.com/maps?q=${detail.capture.lat},${detail.capture.lng}`} target="_blank" rel="noreferrer" style={{ color: '#335231' }}>map</a>
                  </strong>
                ) : <strong style={{ color: '#c0392b' }}>not shared</strong>}
              </div>
              <div style={{ wordBreak: 'break-all' }}>Device: <span style={{ color: '#111' }}>{detail.capture.userAgent ?? '—'}</span></div>

              <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8, marginTop: 4, fontWeight: 600, color: '#111' }}>Documents as submitted</div>
              {([['Certificate', detail.certificateSeal], ['Affidavit', detail.affidavitSeal]] as const).map(([label, seal]) => (
                <div key={label} style={{ wordBreak: 'break-all' }}>
                  {label}: {seal.sha256
                    ? <><strong style={{ color: '#111' }}>{seal.bytes ? `${(seal.bytes / 1000).toFixed(0)} KB` : ''}</strong> <code style={{ fontSize: 11, color: '#111' }}>{seal.sha256}</code></>
                    : <strong style={{ color: '#999' }}>not hashed (submitted before Batch 9)</strong>}
                </div>
              ))}
            </div>
          </div>

          {/* Witnesses */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 12 }}>Named by the claimant</h3>
            {detail.witnesses.length === 0 ? (
              <div style={{ fontSize: 13, color: '#999' }}>No witnesses named (claim predates Batch 9)</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                {detail.witnesses.map(w => (
                  <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span><strong style={{ color: '#111' }}>{w.name}</strong> <span style={{ color: '#666' }}>· {w.email}</span></span>
                    <span style={{ color: '#999', whiteSpace: 'nowrap' }}>{w.role === 'club_official' ? 'Club official' : 'Playing partner'}</span>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>Confirmation requests to these people arrive with Batch 11. Until then, phone the club.</div>
              </div>
            )}
          </div>

          {/* Risk flags */}
          <div style={{ background: '#fff', borderRadius: 12, border: `1px solid ${detail.riskScore >= 6 ? '#f5b7b1' : '#e5e5e5'}`, padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 4 }}>Risk Flags</h3>
            <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
              Re-evaluated each time this page opens. Score {detail.riskScore}. Nothing here decides; each flag needs a line in the notes.
            </div>
            {detail.riskFlags.length === 0 ? (
              <div style={{ fontSize: 13, color: '#1a7f37' }}>No rules fired.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {detail.riskFlags.map(flag => (
                  <div key={flag.rule} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{
                      flexShrink: 0, marginTop: 2, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: flag.severity === 'high' ? '#fde8e8' : flag.severity === 'medium' ? '#fff4e0' : '#f0f0f0',
                      color: flag.severity === 'high' ? '#c0392b' : flag.severity === 'medium' ? '#b8860b' : '#666',
                    }}>{flag.severity}</span>
                    <div style={{ fontSize: 13 }}>
                      <div style={{ fontWeight: 600, color: '#111' }}>{RULE_LABELS[flag.rule]?.label ?? flag.rule}</div>
                      <div style={{ color: '#333' }}>{describeFlag(flag)}</div>
                      <div style={{ color: '#999', fontSize: 12 }}>{RULE_LABELS[flag.rule]?.why}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Audit trail */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 12 }}>Audit Trail</h3>
            {detail.events.length === 0 ? (
              <div style={{ fontSize: 13, color: '#999' }}>No events recorded (bet predates the audit log)</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {detail.events.map(ev => (
                  <div key={ev.id} style={{ padding: '8px 10px', background: '#fafafa', borderRadius: 6, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666' }}>
                      <span>{new Date(ev.created_at).toLocaleString('en-ZA')}</span>
                      <span>{ev.table_name} · {ev.action} · {ev.actor_role}{ev.actor_id ? ` · ${ev.actor_id.slice(0, 8)}…` : ''}</span>
                    </div>
                    {ev.changed && (
                      <div style={{ color: '#111', marginTop: 4 }}>
                        {Object.entries(ev.changed).map(([k, v]) => (
                          <div key={k}><code>{k}</code>: {String(v.from ?? '∅')} → {String(v.to ?? '∅')}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* User history */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 12 }}>User History</h3>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
              Total attempts: <strong style={{ color: '#111' }}>{detail.userTotalAttempts}</strong>
            </div>
            {detail.userBetHistory.length === 0 ? (
              <div style={{ fontSize: 13, color: '#999' }}>No previous bets</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {detail.userBetHistory.map((bet) => (
                  <div
                    key={bet.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 10px', background: '#fafafa', borderRadius: 6, fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#666' }}>{bet.courseName}, H{bet.holeNumber}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ color: '#111', fontWeight: 500 }}>{formatZAR(bet.stakeCents)}</span>
                      <StatusBadge status={bet.status} small />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Verification timeline */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 16 }}>Verification Timeline</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {TIMELINE_STAGES.map((stage, i) => {
                const Icon = stage.icon
                const isDone = i <= currentStageIdx
                const isRejected = detail.status === 'rejected'
                return (
                  <div key={stage.key} style={{ display: 'flex', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div
                        style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: isDone ? '#335231' : isRejected && i === 0 ? '#c0392b' : '#f0f0f0',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Icon size={14} color={isDone ? '#fff' : '#999'} />
                      </div>
                      {i < TIMELINE_STAGES.length - 1 && (
                        <div style={{ width: 2, height: 24, background: isDone ? '#335231' : '#e5e5e5' }} />
                      )}
                    </div>
                    <div style={{ paddingTop: 4, paddingBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: isDone ? 600 : 400, color: isDone ? '#111' : '#999' }}>
                        {stage.label}
                      </div>
                    </div>
                  </div>
                )
              })}
              {detail.status === 'rejected' && (
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div
                      style={{
                        width: 28, height: 28, borderRadius: '50%', background: '#c0392b',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <XCircle size={14} color="#fff" />
                    </div>
                  </div>
                  <div style={{ paddingTop: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#c0392b' }}>Rejected</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Admin notes + actions */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 12 }}>Reviewer Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={`Say what you checked and why you decided. At least ${MIN_DECISION_NOTES} characters to approve or reject.`}
              style={{
                width: '100%', padding: 12, borderRadius: 8, border: '1px solid #e5e5e5',
                fontSize: 13, resize: 'vertical', minHeight: 80, marginBottom: 16,
                fontFamily: "'Inter', system-ui, sans-serif",
              }}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              {detail.status !== 'approved' && detail.status !== 'rejected' && (
                <>
                  {detail.status !== 'under_review' && (
                    <button
                      onClick={() => handleAction('under_review')}
                      disabled={submitting}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '10px 20px', borderRadius: 8, border: '1px solid #e5e5e5',
                        background: '#fff', fontSize: 14, cursor: 'pointer', color: '#333', fontWeight: 500,
                      }}
                    >
                      <Clock size={16} /> Mark Under Review
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmAction('approve')}
                    disabled={submitting}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '10px 20px', borderRadius: 8, border: 'none',
                      background: '#1a7f37', fontSize: 14, cursor: 'pointer', color: '#fff', fontWeight: 600,
                    }}
                  >
                    <CheckCircle size={16} /> Approve Claim
                  </button>
                  <button
                    onClick={() => setConfirmAction('reject')}
                    disabled={submitting}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '10px 20px', borderRadius: 8, border: 'none',
                      background: '#c0392b', fontSize: 14, cursor: 'pointer', color: '#fff', fontWeight: 600,
                    }}
                  >
                    <XCircle size={16} /> Reject
                  </button>
                </>
              )}
              {detail.status === 'approved' && detail.betStatus === 'verified' && (
                <button
                  onClick={() => setConfirmAction('pay')}
                  disabled={submitting}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '10px 20px', borderRadius: 8, border: 'none',
                    background: '#335231', fontSize: 14, cursor: 'pointer', color: '#fff', fontWeight: 600,
                  }}
                >
                  <CheckCircle size={16} /> Confirm Payout Made
                </button>
              )}
              {detail.betStatus === 'paid' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: '#335231' }}>
                  <CheckCircle size={16} /> Prize paid
                </span>
              )}
            </div>
            {payoutError && <div style={{ marginTop: 10, fontSize: 13, color: '#c0392b' }}>{payoutError}</div>}
            {actionError && <div style={{ marginTop: 10, fontSize: 13, color: '#c0392b' }}>{actionError}</div>}
            {detail.reviewChecklist && (
              <div style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
                {detail.reviewChecklist.batch
                  ? 'Approved through the batch action: no per-claim checklist was completed.'
                  : `Checklist completed ${typeof detail.reviewChecklist.completed_at === 'string' ? new Date(detail.reviewChecklist.completed_at).toLocaleString('en-ZA') : ''}.`}
                {detail.payoutReference && <> Payout reference: <strong style={{ color: '#111' }}>{detail.payoutReference}</strong></>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation modals */}
      <ConfirmModal
        open={confirmAction === 'approve'}
        title="Approve This Claim"
        message={`This will verify the hole-in-one claim and authorize a payout of ${formatZAR(detail.potentialWinCents)} to ${detail.userName}. This action moves the bet to "verified" status.`}
        confirmLabel={checklistComplete && notesOk ? 'Approve & Verify' : 'Complete the checklist first'}
        variant="success"
        onConfirm={() => { if (checklistComplete && notesOk) handleAction('approve') }}
        onCancel={() => setConfirmAction(null)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: '#333' }}>
          {REVIEW_CHECKLIST.map(item => (
            <label key={item.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!checklist[item.key]} onChange={e => setChecklist(c => ({ ...c, [item.key]: e.target.checked }))} style={{ marginTop: 3 }} />
              <span>{item.label}</span>
            </label>
          ))}
          {!notesOk && <div style={{ color: '#c0392b', fontSize: 12 }}>Reviewer notes need at least {MIN_DECISION_NOTES} characters: say how the certificate was confirmed and what you made of each flag.</div>}
        </div>
      </ConfirmModal>
      <ConfirmModal
        open={confirmAction === 'pay'}
        title="Confirm the Prize Was Paid"
        message="Only confirm once the money has actually left the account. This marks the bet as paid, publishes it on the winners list, and is recorded in the audit trail with your admin id."
        confirmLabel={payoutReference.trim().length >= 3 ? 'Yes, the prize was paid' : 'Enter the payout reference'}
        variant="success"
        onConfirm={() => { if (payoutReference.trim().length >= 3) confirmPayout() }}
        onCancel={() => setConfirmAction(null)}
      >
        <label style={{ display: 'block', fontSize: 13, color: '#333' }}>
          Bank or PayFast reference
          <input
            value={payoutReference}
            onChange={e => setPayoutReference(e.target.value)}
            placeholder="e.g. FNB-2026-09-15-0042"
            style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e5e5', fontSize: 13 }}
          />
        </label>
      </ConfirmModal>
      <ConfirmModal
        open={confirmAction === 'reject'}
        title="Reject This Claim"
        message={`This will reject ${detail.userName}'s claim for ${formatZAR(detail.potentialWinCents)}. The bet will remain as "claimed" and no payout will be issued.`}
        confirmLabel={notesOk ? 'Reject Claim' : 'Write the reason first'}
        variant="danger"
        onConfirm={() => { if (notesOk) handleAction('reject') }}
        onCancel={() => setConfirmAction(null)}
      >
        {!notesOk && <div style={{ color: '#c0392b', fontSize: 12 }}>The reason goes in the reviewer notes (at least {MIN_DECISION_NOTES} characters) and is kept in the audit trail.</div>}
      </ConfirmModal>
    </div>
  )
}
