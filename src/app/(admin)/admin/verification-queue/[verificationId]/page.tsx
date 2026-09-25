'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, ArrowRight, CheckCircle, Clock, Download, XCircle } from 'lucide-react'
import StatusBadge from '@/components/admin/StatusBadge'
import VideoPlayer from '@/components/admin/VideoPlayer'
import DocumentViewer from '@/components/admin/DocumentViewer'
import ConfirmModal from '@/components/admin/ConfirmModal'
import LoadError from '@/components/admin/LoadError'
import { formatZAR, timeAgo } from '@/lib/format'
import { TIER_LABELS } from '@/lib/tiers'
import type { PaginatedResponse, VerificationQueueItem } from '@/types/admin'
import { REVIEW_CHECKLIST, MIN_DECISION_NOTES } from '@/lib/claims/checklist'
import { RULE_LABELS, describeFlag } from '@/lib/risk/labels'
import { OPEN_REVIEW_STATUSES, type VerificationReview } from '@/app/api/admin/verifications/review-types'
import { daySA, failureMessage, whenSA } from '../helpers'
import styles from './review.module.css'

/** The shortest payout reference PATCH /api/admin/bets/[betId] accepts. */
const MIN_REFERENCE = 3

/** Signed links last an hour. Past this age, a reviewer coming back to the tab gets new ones before they are needed. */
const STALE_MS = 50 * 60_000

type Confirm = 'approve' | 'reject' | 'pay'
interface Warning { text: string; href?: string; action?: string }

const PAYMENT_PILL: Record<NonNullable<VerificationReview['payment']>['status'], { label: string; pill: string }> = {
  complete: { label: 'Paid', pill: 'adm-pill adm-pill--lime' },
  pending: { label: 'Pending', pill: 'adm-pill adm-pill--amber' },
  failed: { label: 'Failed', pill: 'adm-pill adm-pill--red' },
  amount_mismatch: { label: 'Amount mismatch', pill: 'adm-pill adm-pill--red' },
  missing: { label: 'No payment found', pill: 'adm-pill adm-pill--red' },
}

/** Anything about the player or the money that should stop a reviewer before approving or paying. */
function warningsFor(d: VerificationReview): Warning[] {
  const out: Warning[] = []
  if (d.player.suspendedAt) {
    out.push({
      text: `The player's account is suspended (since ${daySA(d.player.suspendedAt)}${d.player.suspendedReason ? `: ${d.player.suspendedReason}` : ''}). Do not pay out until that is resolved.`,
      href: `/admin/users/${d.userId}`, action: 'Open the player',
    })
  }
  if (!d.player.ageVerifiedAt) out.push({ text: 'The player has not passed the 18+ age check.', href: `/admin/users/${d.userId}`, action: 'Open the player' })
  const p = d.payment
  if (p && p.status !== 'complete') {
    const text = p.status === 'missing' ? `No payment is on record for this ${formatZAR(d.stakeCents)} entry${p.reference ? ` (reference ${p.reference})` : ''}.`
      : p.status === 'pending' ? 'The payment for this entry is still pending, not complete.'
      : p.status === 'failed' ? 'The payment for this entry failed.'
      : `The amount PayFast took (${formatZAR(p.amountCents ?? 0)}) does not match the price of this entry.`
    out.push({ text, href: `/admin/bets/${d.betId}`, action: 'Open the bet' })
  }
  if (d.riskCheck === 'failed') {
    out.push({ text: `The risk check failed just now, so the flags shown are the stored result${d.riskEvaluatedAt ? ` from ${whenSA(d.riskEvaluatedAt)}` : ''}.` })
  }
  return out
}

/**
 * One claim, for the reviewer: the evidence on the left, the decision on the
 * right (kept in view), and everything else below it. Approving pays out,
 * so it needs the checklist and a reason; after a decision the next open
 * claim is one click away.
 */
export default function VerificationDetailPage() {
  const { verificationId } = useParams<{ verificationId: string }>()
  const [detail, setDetail] = useState<VerificationReview | null>(null)
  const [loadFailure, setLoadFailure] = useState<{ status: number; message: string | null } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const loadedAt = useRef(0)
  const inFlight = useRef(false)
  const notesSeeded = useRef(false)

  const [notes, setNotes] = useState('')
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [payoutReference, setPayoutReference] = useState('')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  // After a decision here: the next open claim (id), none waiting (null), or the lookup failed.
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null)
  const [nextClaim, setNextClaim] = useState<{ id: string | null } | 'looking' | 'failed'>('looking')
  const [showHistory, setShowHistory] = useState(false)
  const [pack, setPack] = useState<{ busy: boolean; hash?: string | null; error?: string }>({ busy: false })
  const [witnessBusy, setWitnessBusy] = useState<string | null>(null)
  const [witnessNote, setWitnessNote] = useState<{ ok: boolean; text: string } | null>(null)

  /** Load the claim. `fresh` re-runs the risk rules; a reload for new links or after an action does not. */
  const load = useCallback(async (fresh: boolean): Promise<void> => {
    try {
      const res = await fetch(`/api/admin/verifications/${verificationId}${fresh ? '' : '?fresh=0'}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json) {
        setLoadFailure({ status: res.status, message: failureMessage(res.status, json?.error) })
        return
      }
      const data = json as VerificationReview
      loadedAt.current = Date.now()
      if (!notesSeeded.current) {
        notesSeeded.current = true
        setNotes(data.reviewerNotes ?? '')
      }
      setDetail(data)
      setLoadFailure(null)
    } catch (err) {
      console.error('[admin] claim load failed:', err)
      setLoadFailure({ status: 0, message: null })
    }
  }, [verificationId])

  /** New links and the latest state. One at a time: focus and visibility can fire together. */
  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRefreshing(true)
    try {
      await load(false)
    } finally {
      inFlight.current = false
      setRefreshing(false)
    }
  }, [load])

  useEffect(() => { void load(true) }, [load])

  // A reviewer who phoned the club comes back to links that have expired: renew them first.
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== 'visible' || !loadedAt.current) return
      if (Date.now() - loadedAt.current > STALE_MS) void refresh()
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [refresh])

  // The footage failed: if its link is old enough to have expired, fetch new links by themselves.
  const onLinkError = useCallback(() => {
    if (Date.now() - loadedAt.current > STALE_MS) void refresh()
  }, [refresh])

  const findNext = async () => {
    setNextClaim('looking')
    try {
      const res = await fetch('/api/admin/verifications?stage=open&sort=oldest&limit=5')
      if (!res.ok) { setNextClaim('failed'); return }
      const json = await res.json() as PaginatedResponse<VerificationQueueItem>
      setNextClaim({ id: json.data.find(v => v.id !== verificationId)?.id ?? null })
    } catch {
      setNextClaim('failed')
    }
  }

  const closeConfirm = () => { setConfirm(null); setModalError(null) }
  const openConfirm = (c: Confirm) => { setModalError(null); setPanelError(null); setConfirm(c) }

  const review = async (status: 'approved' | 'rejected' | 'under_review') => {
    // A decision's error belongs in its modal; "under review" has no modal.
    const fail = status === 'under_review' ? setPanelError : setModalError
    setBusy(true)
    setModalError(null)
    setPanelError(null)
    try {
      const reviewerNotes = notes.trim()
      const res = await fetch(`/api/admin/verifications/${verificationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(reviewerNotes ? { reviewerNotes } : {}), ...(status === 'approved' ? { checklist } : {}) }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        if (res.status === 409) {
          fail(`${json?.error ?? 'This claim changed.'} Someone else may have acted on it; the page has been reloaded to show where it stands.`)
          void load(false)
        } else {
          fail(failureMessage(res.status, json?.error) ?? 'The decision could not be saved. Try again.')
        }
        return
      }
      setConfirm(null)
      if (status !== 'under_review') {
        setDecided(status)
        void findNext()
      }
      await load(false)
    } catch (err) {
      console.error('[admin] review request failed:', err)
      fail('The request did not complete, so it may not have been saved. Reload the claim to check before trying again.')
    } finally {
      setBusy(false)
    }
  }

  const recordPayout = async () => {
    if (!detail) return
    const reference = payoutReference.trim()
    setBusy(true)
    setModalError(null)
    try {
      const res = await fetch(`/api/admin/bets/${detail.betId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid', payoutReference: reference }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setModalError(failureMessage(res.status, json?.error) ?? 'The payout could not be recorded. Try again.')
        if (res.status === 409) void load(false)
        return
      }
      setConfirm(null)
      setPayoutReference('')
      await load(false)
    } catch (err) {
      console.error('[admin] payout request failed:', err)
      setModalError('The request did not complete, so the payout may not have been recorded. Reload the claim to check before trying again.')
    } finally {
      setBusy(false)
    }
  }

  const sendAgain = async (witnessId: string) => {
    setWitnessBusy(witnessId)
    setWitnessNote(null)
    try {
      const res = await fetch(`/api/admin/verifications/${verificationId}/witness-requests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ witnessId }),
      })
      const json = await res.json().catch(() => null) as { sent?: number; failed?: number; error?: string } | null
      if (!res.ok) {
        setWitnessNote({ ok: false, text: failureMessage(res.status, json?.error) ?? 'The request could not be sent. Try again.' })
        return
      }
      const sent = json?.sent ?? 0
      const failed = json?.failed ?? 0
      setWitnessNote(
        failed > 0 ? { ok: false, text: `The email could not be sent${sent ? ` to ${failed} of ${sent + failed}` : ''}. Try again in a few minutes.` }
        : sent > 0 ? { ok: true, text: 'Sent, with a new link. The old link no longer works.' }
        : { ok: false, text: 'Nothing was sent: this person has already answered.' },
      )
      await load(false)
    } catch (err) {
      console.error('[admin] witness request failed:', err)
      setWitnessNote({ ok: false, text: 'The server could not be reached, so nothing was sent.' })
    } finally {
      setWitnessBusy(null)
    }
  }

  const exportPack = async () => {
    setPack({ busy: true })
    try {
      const res = await fetch(`/api/admin/verifications/${verificationId}/evidence-pack`)
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setPack({ busy: false, error: `The evidence pack could not be made. ${failureMessage(res.status, json?.error) ?? 'Try again.'}` })
        return
      }
      const hash = res.headers.get('x-evidence-sha256')
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `evidence-${detail?.betId ?? verificationId}.json`
      a.click()
      // Revoked a moment later: some browsers start the download after click() returns.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setPack({ busy: false, hash })
    } catch (err) {
      console.error('[admin] evidence pack failed:', err)
      setPack({ busy: false, error: 'The evidence pack could not be downloaded. Check your connection and try again.' })
    }
  }

  if (!detail) {
    return (
      <div>
        <title>Claim review · Get Lucky admin</title>
        <p style={{ margin: '0 0 16px' }}><Link href="/admin/verification-queue" className="adm-link">Verification queue</Link></p>
        {!loadFailure ? (
          <div className="adm-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="adm-spinner" aria-hidden style={{ width: 28, height: 28 }} />
            <span className="adm-muted">Loading the claim…</span>
          </div>
        ) : loadFailure.status === 404 ? (
          <div className="adm-card">
            <h1 className="adm-h2" style={{ marginBottom: 8 }}>There is no such claim</h1>
            <p className="adm-muted" style={{ margin: '0 0 14px' }}>The link may be wrong, or the claim was removed with its account.</p>
            <Link href="/admin/verification-queue" className="adm-btn adm-btn--quiet" style={{ textDecoration: 'none' }}>Back to the queue</Link>
          </div>
        ) : (
          <LoadError what="This claim" detail={loadFailure.message} onRetry={() => { setLoadFailure(null); void load(true) }} />
        )}
      </div>
    )
  }

  const d = detail
  const name = d.userName || d.player.email || 'Unnamed player'
  const payee = d.userName || d.player.email || 'the player'
  const prize = formatZAR(d.potentialWinCents)
  const isOpen = (OPEN_REVIEW_STATUSES as readonly string[]).includes(d.status)
  const warnings = warningsFor(d)
  const checklistComplete = REVIEW_CHECKLIST.every(i => checklist[i.key])
  const notesLength = notes.trim().length
  const notesOk = notesLength >= MIN_DECISION_NOTES
  const hole = [`hole ${d.holeNumber || '?'}`, d.hole.par ? `par ${d.hole.par}` : null, d.hole.distanceMetres ? `${d.hole.distanceMetres} m` : null].filter(Boolean).join(', ')
  const videoUnsigned = d.unsignedMedia.includes('video')

  const notesField = (label: string) => (
    <label className="adm-field">
      {label}
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={4}
        className="adm-input"
        placeholder="What you checked, who at the club confirmed the certificate, and what you made of each flag."
      />
      <span className="adm-hint">
        Kept in the audit trail. At least {MIN_DECISION_NOTES} characters to approve or reject{notesOk ? '' : ` (${notesLength} so far)`}.
      </span>
    </label>
  )

  const warningList = (compact: boolean) => warnings.length > 0 && (
    <ul style={{ margin: compact ? '10px 0 0' : 0, paddingLeft: 18, fontSize: compact ? 13 : 14, lineHeight: 1.5 }}>
      {warnings.map(w => (
        <li key={w.text}>
          {w.text}
          {!compact && w.href && <> <Link href={w.href} className="adm-link">{w.action}</Link></>}
        </li>
      ))}
    </ul>
  )

  return (
    <div>
      <title>{`Claim: ${name} · Get Lucky admin`}</title>
      <nav aria-label="Breadcrumb" className="adm-small" style={{ marginBottom: 10 }}>
        <Link href="/admin/verification-queue" className="adm-link">Verification queue</Link> / Claim review
      </nav>
      <div className="adm-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="adm-title">{name}</h1>
          <p className="adm-lead">
            {d.courseName || 'Unknown course'}, {hole} · {TIER_LABELS[d.tier] || d.tier} · prize {prize}.{' '}
            <Link href={`/admin/bets/${d.betId}`} className="adm-link">Open the bet</Link>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusBadge status={d.status} />
          {d.betStatus === 'paid' && <StatusBadge status="paid" />}
          {refreshing && <span className="adm-small">Refreshing…</span>}
        </div>
      </div>

      {loadFailure && (
        <p role="alert" className="adm-error" style={{ margin: '0 0 14px' }}>
          The claim could not be refreshed{loadFailure.message ? `: ${loadFailure.message}` : ''}. What you see may be out of date, and its links may have expired.{' '}
          <button type="button" className="adm-link" onClick={() => void refresh()}>Try again</button>
        </p>
      )}

      {warnings.length > 0 && (
        <div role="alert" className="adm-card" style={{ border: '2px solid #f3d08a', background: '#fffaf0', marginBottom: 16 }}>
          <h2 className="adm-h3" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#7a5200' }}>
            <AlertTriangle size={16} aria-hidden /> Check before deciding
          </h2>
          {warningList(false)}
        </div>
      )}

      <div className="adm-grid-2">
        {/* LEFT: the evidence */}
        <div style={{ minWidth: 0 }}>
          <section className="adm-card" aria-labelledby="footage-h">
            <h2 id="footage-h" className="adm-h2" style={{ marginBottom: 12 }}>Footage</h2>
            <VideoPlayer
              key={d.id}
              src={d.videoSignedUrl}
              emptyText={
                videoUnsigned ? 'The footage is on record, but its link could not be made.'
                : d.footagePurgedAt ? `The footage was deleted under the retention policy on ${daySA(d.footagePurgedAt)}.`
                : 'No footage was uploaded.'
              }
              onLinkError={onLinkError}
              onReload={d.videoSignedUrl || videoUnsigned ? () => void refresh() : undefined}
            />
          </section>

          <section className="adm-card" aria-labelledby="docs-h">
            <h2 id="docs-h" className="adm-h2" style={{ marginBottom: 12 }}>Documents</h2>
            <DocumentViewer
              key={d.id}
              certificateUrl={d.certificateSignedUrl}
              affidavitUrl={d.affidavitSignedUrl}
              certificatePath={d.certificatePath}
              affidavitPath={d.affidavitPath}
              certificateDownloadUrl={d.certificateDownloadUrl}
              affidavitDownloadUrl={d.affidavitDownloadUrl}
              unsigned={d.unsignedMedia}
              onReload={() => void refresh()}
            />
          </section>

          <section className="adm-card" aria-labelledby="integrity-h">
            <h2 id="integrity-h" className="adm-h2" style={{ marginBottom: 12 }}>Evidence integrity</h2>
            <dl className="adm-dl">
              <Fact label="Bet opened">{whenSA(d.betCreatedAt)}</Fact>
              <Fact label="Play window closed">{whenSA(d.betExpiresAt)}</Fact>
              <Fact label="Footage sealed">
                {d.videoUploadedAt
                  ? <>{whenSA(d.videoUploadedAt)}{d.betExpiresAt && d.videoUploadedAt > d.betExpiresAt && <Bad> (after the window closed)</Bad>}</>
                  : <Bad>not recorded: the server never sealed the footage</Bad>}
              </Fact>
              <Fact label="Footage size">{d.videoBytes ? `${(d.videoBytes / 1_000_000).toFixed(1)} MB` : '—'}</Fact>
              <Fact label="SHA-256"><span className="adm-mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{d.videoSha256 ?? '—'}</span></Fact>
            </dl>

            <h3 className="adm-h3" style={{ margin: '16px 0 8px' }}>Recorder report</h3>
            <dl className="adm-dl">
              {d.capture.startedAt ? (
                <>
                  <Fact label="Recording">
                    {whenSA(d.capture.startedAt)}{d.capture.durationMs != null && <>, for {Math.round(d.capture.durationMs / 1000)} s</>}
                  </Fact>
                  <Fact label="Sealed after">
                    {d.capture.uploadLagS == null ? '—'
                      : d.capture.uploadLagS > 15 * 60
                      ? <Bad>{Math.round(d.capture.uploadLagS / 60)} min (a long gap between recording and upload)</Bad>
                      : d.capture.uploadLagS < 120 ? `${d.capture.uploadLagS} s` : `${Math.round(d.capture.uploadLagS / 60)} min`}
                  </Fact>
                </>
              ) : (
                <Fact label="Recording"><Bad>no recorder timestamps</Bad> (an older app, or the report failed its checks)</Fact>
              )}
              <Fact label="Location">
                {d.capture.lat != null && d.capture.lng != null ? (
                  <>
                    {d.capture.distanceM != null
                      ? (d.capture.distanceM > 2000 ? <Bad>{(d.capture.distanceM / 1000).toFixed(1)} km from the course</Bad>
                        : d.capture.distanceM < 1000 ? `${d.capture.distanceM} m from the course` : `${(d.capture.distanceM / 1000).toFixed(1)} km from the course`)
                      : 'recorded; the course has no coordinates'}
                    {d.capture.accuracyM != null ? ` (±${d.capture.accuracyM} m)` : ''}{' '}
                    <a href={`https://www.google.com/maps?q=${d.capture.lat},${d.capture.lng}`} target="_blank" rel="noreferrer" className="adm-link">map</a>
                  </>
                ) : <Bad>not shared</Bad>}
              </Fact>
              <Fact label="Device"><span style={{ wordBreak: 'break-all' }}>{d.capture.userAgent ?? '—'}</span></Fact>
            </dl>

            <h3 className="adm-h3" style={{ margin: '16px 0 8px' }}>Documents as submitted</h3>
            <dl className="adm-dl">
              {([['Certificate', d.certificateSeal], ['Affidavit', d.affidavitSeal]] as const).map(([label, seal]) => (
                <Fact key={label} label={label}>
                  {seal.sha256
                    ? <>{seal.bytes ? `${(seal.bytes / 1000).toFixed(0)} KB ` : ''}<span className="adm-mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{seal.sha256}</span></>
                    : <span className="adm-muted">not hashed (submitted before Batch 9)</span>}
                </Fact>
              ))}
            </dl>
          </section>

          <section className="adm-card" aria-labelledby="witnesses-h">
            <h2 id="witnesses-h" className="adm-h2" style={{ marginBottom: 12 }}>Named by the claimant</h2>
            {d.witnesses.length === 0 ? (
              <p className="adm-muted" style={{ margin: 0, fontSize: 13 }}>No witnesses named (the claim predates Batch 9).</p>
            ) : (
              <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
                {d.witnesses.map(w => {
                  const state = w.response === 'confirmed' ? { text: `Confirmed ${whenSA(w.respondedAt)}`, pill: 'adm-pill adm-pill--lime' }
                    : w.response === 'denied' ? { text: `Said no ${whenSA(w.respondedAt)}`, pill: 'adm-pill adm-pill--red' }
                    : w.linkExpired ? { text: 'Link expired, no answer', pill: 'adm-pill adm-pill--amber' }
                    : w.requestedAt ? { text: `Asked ${daySA(w.requestedAt)}${w.requestCount > 1 ? ` (×${w.requestCount})` : ''}, no answer yet`, pill: 'adm-pill' }
                    : { text: 'Not asked yet', pill: 'adm-pill adm-pill--red' }
                  return (
                    <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div><strong>{w.name}</strong> <a href={`mailto:${w.email}`} className="adm-muted">{w.email}</a></div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                          <span className="adm-small">{w.role === 'club_official' ? 'Club official' : 'Playing partner'}{w.source === 'course' ? ' (course contact)' : ''}</span>
                          <span className={state.pill}>{state.text}</span>
                        </div>
                        {w.responseNote && <div style={{ marginTop: 4 }}>&ldquo;{w.responseNote}&rdquo;</div>}
                      </div>
                      {!w.response && (
                        <button type="button" onClick={() => sendAgain(w.id)} disabled={witnessBusy !== null} className="adm-btn adm-btn--quiet">
                          {witnessBusy === w.id ? 'Sending…' : w.requestedAt ? 'Send again' : 'Send request'}
                        </button>
                      )}
                    </div>
                  )
                })}
                {witnessNote && (
                  <p role="status" className={witnessNote.ok ? 'adm-small' : 'adm-error'} style={{ margin: 0 }}>{witnessNote.text}</p>
                )}
                <p className="adm-small" style={{ margin: 0 }}>Answers come to this page and the evidence pack, never to the golfer. Links work once and expire after 14 days.</p>
              </div>
            )}
          </section>
        </div>

        {/* RIGHT: the decision first, kept in view; then the rest */}
        <div style={{ minWidth: 0 }}>
          <section className={`adm-card adm-card--form ${styles.decision}`} aria-labelledby="decision-h">
            <h2 id="decision-h" className="adm-h2" style={{ marginBottom: 8 }}>
              {isOpen ? 'Decision' : d.status === 'approved' && d.betStatus !== 'paid' ? 'Payout' : 'Decided'}
            </h2>

            {isOpen ? (
              <>
                <p style={{ margin: '0 0 12px', fontSize: 14 }}>
                  Approving authorises <strong>{prize}</strong> to <strong>{payee}</strong>
                  {d.userName && d.player.email ? <> ({d.player.email})</> : null}.
                </p>
                {notesField('Reviewer notes')}
                <div className="adm-row" style={{ marginTop: 14, alignItems: 'center' }}>
                  <button type="button" onClick={() => openConfirm('approve')} disabled={busy} className="adm-btn">
                    <CheckCircle size={17} aria-hidden /> Approve
                  </button>
                  <button type="button" onClick={() => openConfirm('reject')} disabled={busy} className="adm-btn adm-btn--quiet adm-btn--danger">
                    <XCircle size={14} aria-hidden /> Reject
                  </button>
                  {d.status !== 'under_review' && (
                    <button type="button" onClick={() => review('under_review')} disabled={busy} className="adm-btn adm-btn--quiet">
                      <Clock size={14} aria-hidden /> {busy && !confirm ? 'Saving…' : 'Mark under review'}
                    </button>
                  )}
                </div>
                {warnings.length > 0 && (
                  <p className="adm-warn" style={{ margin: '10px 0 0' }}>
                    <AlertTriangle size={14} aria-hidden /> Read the {warnings.length === 1 ? 'warning' : `${warnings.length} warnings`} at the top first.
                  </p>
                )}
              </>
            ) : d.status === 'approved' && d.betStatus === 'verified' ? (
              <>
                <p style={{ margin: '0 0 12px', fontSize: 14 }}>
                  Approved {whenSA(d.verifiedAt)}. Pay <strong>{prize}</strong> to <strong>{payee}</strong>
                  {d.userName && d.player.email ? <> ({d.player.email})</> : null}, then record it here with the bank or PayFast reference.
                </p>
                <button type="button" onClick={() => openConfirm('pay')} disabled={busy} className="adm-btn">
                  <CheckCircle size={17} aria-hidden /> Record the payout
                </button>
              </>
            ) : d.betStatus === 'paid' ? (
              <p style={{ margin: 0, fontSize: 14 }}>
                <CheckCircle size={15} aria-hidden style={{ verticalAlign: '-2px' }} /> {prize} paid to {payee}
                {d.payoutInitiatedAt ? `, recorded ${whenSA(d.payoutInitiatedAt)}` : ''}. Reference: <strong className="adm-mono">{d.payoutReference ?? '—'}</strong>
              </p>
            ) : d.status === 'approved' ? (
              <p className="adm-warn" style={{ margin: 0 }}>
                <AlertTriangle size={14} aria-hidden /> Approved, but the bet is {d.betStatus ?? 'missing'}, not verified, so the payout cannot be recorded. <Link href={`/admin/bets/${d.betId}`} className="adm-link">Open the bet</Link>
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: 14 }}>Rejected. No prize is paid.</p>
            )}

            {!isOpen && d.reviewerNotes && (
              <blockquote style={{ margin: '12px 0 0', padding: '10px 12px', borderRadius: 10, background: 'var(--surface)', fontSize: 13, whiteSpace: 'pre-wrap' }}>
                {d.reviewerNotes}
              </blockquote>
            )}
            {d.reviewChecklist && (
              <p className="adm-small" style={{ margin: '10px 0 0' }}>
                {d.reviewChecklist.batch
                  ? 'Approved through the old batch action: no checklist was completed for this claim.'
                  : `Checklist completed ${typeof d.reviewChecklist.completed_at === 'string' ? whenSA(d.reviewChecklist.completed_at) : ''}.`}
              </p>
            )}
            {panelError && <p role="alert" className="adm-error" style={{ margin: '10px 0 0' }}>{panelError}</p>}

            {decided && (
              <div className="adm-row" style={{ marginTop: 14, paddingTop: 14, borderTop: '2px solid var(--surface)', alignItems: 'center' }}>
                <span style={{ flex: '1 1 100%', fontSize: 14, fontWeight: 600 }}>
                  {decided === 'approved' ? 'Approved. The payout is recorded here once it has been made.' : 'Rejected.'}
                </span>
                {nextClaim === 'looking' ? (
                  <span className="adm-small">Finding the next claim…</span>
                ) : nextClaim !== 'failed' && nextClaim.id ? (
                  <Link href={`/admin/verification-queue/${nextClaim.id}`} className="adm-btn" style={{ textDecoration: 'none' }}>
                    Next claim <ArrowRight size={17} aria-hidden />
                  </Link>
                ) : nextClaim !== 'failed' ? (
                  <span className="adm-small">No other claims are waiting.</span>
                ) : null}
                <Link href="/admin/verification-queue" className="adm-btn adm-btn--quiet" style={{ textDecoration: 'none' }}>Back to the queue</Link>
              </div>
            )}
          </section>

          <section className="adm-card" aria-labelledby="claim-h">
            <h2 id="claim-h" className="adm-h2" style={{ marginBottom: 12 }}>The claim</h2>
            <dl className="adm-dl">
              <Fact label="Player">
                <strong>{d.userName || 'No name'}</strong>
                {d.player.email && <> · <a href={`mailto:${d.player.email}`} className="adm-link">{d.player.email}</a></>}
                {' · '}<Link href={`/admin/users/${d.userId}`} className="adm-link">Profile</Link>
                <span style={{ display: 'inline-flex', gap: 6, marginLeft: 8, flexWrap: 'wrap', verticalAlign: 'middle' }}>
                  {d.player.suspendedAt && <span className="adm-pill adm-pill--red">Suspended</span>}
                  {d.player.ageVerifiedAt ? <span className="adm-pill adm-pill--lime">18+ checked</span> : <span className="adm-pill adm-pill--amber">18+ not checked</span>}
                </span>
              </Fact>
              <Fact label="Hole">{d.courseName || 'Unknown course'}, {hole}</Fact>
              <Fact label="Entry">
                {TIER_LABELS[d.tier] || d.tier} · stake {formatZAR(d.stakeCents)} · <Link href={`/admin/bets/${d.betId}`} className="adm-link">Open the bet</Link>
              </Fact>
              <Fact label="Payment">
                {d.payment ? (
                  <>
                    <span className={PAYMENT_PILL[d.payment.status].pill}>{PAYMENT_PILL[d.payment.status].label}</span>
                    {d.payment.amountCents != null && <> {formatZAR(d.payment.amountCents)}</>}
                    {d.payment.reference && <> · <span className="adm-mono" style={{ fontSize: 12 }}>{d.payment.reference}</span></>}
                  </>
                ) : 'A free swing: nothing was paid'}
              </Fact>
              <Fact label="Prize"><strong style={{ fontSize: 16 }}>{prize}</strong></Fact>
              <Fact label="Claimed">{whenSA(d.declaredAt)}</Fact>
              <Fact label="Submitted">{whenSA(d.createdAt)} ({timeAgo(d.createdAt)})</Fact>
              {d.documentsReceivedAt && <Fact label="Documents in">{whenSA(d.documentsReceivedAt)}</Fact>}
            </dl>
          </section>

          <section className="adm-card" aria-labelledby="risk-h" style={d.riskScore >= 6 ? { border: '2px solid #f3c7c7' } : undefined}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <h2 id="risk-h" className="adm-h2">Risk flags</h2>
              <div className="adm-stat">
                <div className="adm-stat-label">Score</div>
                <div className={`adm-stat-value${d.riskScore >= 6 ? ' adm-stat-value--alert' : ''}`}>{d.riskScore}</div>
              </div>
            </div>
            {d.riskCheck === 'failed' ? (
              <p className="adm-warn" style={{ margin: '4px 0 10px' }}>
                <AlertTriangle size={14} aria-hidden /> The risk check failed, so this is the stored result{d.riskEvaluatedAt ? ` from ${whenSA(d.riskEvaluatedAt)}` : ''}.
              </p>
            ) : (
              <p className="adm-small" style={{ margin: '4px 0 10px' }}>
                {d.riskCheck === 'fresh' ? 'Checked again when this page opened.' : `Last checked ${whenSA(d.riskEvaluatedAt)}.`} Nothing here decides; each flag needs a line in the notes.
              </p>
            )}
            {d.riskFlags.length === 0 ? (
              d.riskCheck === 'failed'
                ? <p className="adm-warn" style={{ margin: 0 }}>No flags on record, but the rules did not run just now.</p>
                : <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}><CheckCircle size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> No rules fired.</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {d.riskFlags.map(flag => (
                  <div key={flag.rule} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
                    <span className={`adm-pill ${flag.severity === 'high' ? 'adm-pill--red' : flag.severity === 'medium' ? 'adm-pill--amber' : ''}`} style={{ textTransform: 'uppercase', fontSize: 11 }}>
                      {flag.severity}
                    </span>
                    <div>
                      <div style={{ fontWeight: 700 }}>{RULE_LABELS[flag.rule]?.label ?? flag.rule}</div>
                      <div>{describeFlag(flag)}</div>
                      <div className="adm-small">{RULE_LABELS[flag.rule]?.why}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="adm-card" aria-labelledby="player-h">
            <h2 id="player-h" className="adm-h2" style={{ marginBottom: 6 }}>The player&rsquo;s bets</h2>
            <p className="adm-small" style={{ margin: '0 0 10px' }}>{d.userTotalAttempts} attempts in all. The latest five:</p>
            {d.userBetHistory.length === 0 ? (
              <p className="adm-muted" style={{ margin: 0, fontSize: 13 }}>No bets on record.</p>
            ) : (
              <div className="adm-table-wrap">
                <table className="adm-table" style={{ minWidth: 0 }}>
                  <tbody>
                    {d.userBetHistory.map(b => (
                      <tr key={b.id}>
                        <td><Link href={`/admin/bets/${b.id}`} className="adm-row-link">{b.courseName || 'Unknown course'}, hole {b.holeNumber || '?'}</Link>{b.id === d.betId && <span className="adm-small"> (this claim)</span>}</td>
                        <td className="adm-muted">{daySA(b.createdAt)}</td>
                        <td className="adm-num">{formatZAR(b.stakeCents)}</td>
                        <td style={{ textAlign: 'right' }}><StatusBadge status={b.status} small /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="adm-card" aria-labelledby="history-h">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <h2 id="history-h" className="adm-h2">History</h2>
              <button type="button" onClick={exportPack} disabled={pack.busy} className="adm-btn adm-btn--quiet">
                <Download size={14} aria-hidden /> {pack.busy ? 'Preparing…' : 'Export evidence pack'}
              </button>
            </div>
            {pack.error && <p role="alert" className="adm-error" style={{ margin: '0 0 12px' }}>{pack.error}</p>}
            {pack.hash !== undefined && !pack.error && (
              <p className="adm-small" style={{ margin: '0 0 12px', wordBreak: 'break-all' }}>
                {pack.hash
                  ? <>Pack SHA-256: <span className="adm-mono" style={{ fontSize: 11 }}>{pack.hash}</span>. Send the file and this hash together; the insurer checks it with <code>sha256sum</code>.</>
                  : 'The pack was downloaded, but the server did not send its hash. Export it again before sending it.'}
              </p>
            )}
            <Timeline status={d.status} paid={d.betStatus === 'paid'} />
            <button
              type="button"
              className="adm-link"
              aria-expanded={showHistory}
              aria-controls="audit-trail"
              onClick={() => setShowHistory(s => !s)}
              style={{ marginTop: 14 }}
            >
              {showHistory ? 'Hide history' : `Show history (${d.events.length}${d.events.length >= 200 ? '+' : ''})`}
            </button>
            {showHistory && (
              <div id="audit-trail" style={{ marginTop: 10 }}>
                {d.events.length === 0 ? (
                  <p className="adm-muted" style={{ margin: 0, fontSize: 13 }}>No events recorded (the bet predates the audit log).</p>
                ) : (
                  <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {d.events.map(ev => (
                      <li key={ev.id} style={{ padding: '8px 10px', background: 'var(--surface)', borderRadius: 8, fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }} className="adm-muted">
                          <span>{whenSA(ev.created_at)}</span>
                          <span>{ev.table_name} · {ev.action} · {ev.actor_role}{ev.actor_id ? ` · ${ev.actor_id.slice(0, 8)}…` : ''}</span>
                        </div>
                        {ev.changed && (
                          <div style={{ marginTop: 4 }}>
                            {Object.entries(ev.changed).map(([k, v]) => (
                              <div key={k} style={{ wordBreak: 'break-word' }}><code>{k}</code>: {String(v.from ?? '∅')} → {String(v.to ?? '∅')}</div>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmModal
        open={confirm === 'approve'}
        title="Approve this claim"
        message={`This verifies the hole-in-one and authorises a prize of ${prize} to ${payee}. The bet moves to verified, ready for the payout.`}
        confirmLabel="Approve and verify"
        variant="success"
        onConfirm={() => review('approved')}
        onCancel={closeConfirm}
        busy={busy}
        confirmDisabled={!checklistComplete || !notesOk}
        error={modalError}
      >
        {/* The modal has no scroll of its own; a long checklist must not push the buttons off a small screen. */}
        <div style={{ maxHeight: '50vh', overflowY: 'auto', display: 'grid', gap: 12 }}>
          <fieldset className="adm-fieldset" style={{ padding: 0, borderTop: 'none' }}>
            <legend className="adm-h3" style={{ marginBottom: 8 }}>I confirm</legend>
            {REVIEW_CHECKLIST.map(item => (
              <label key={item.key} className="adm-check" style={{ display: 'flex', alignItems: 'flex-start', fontWeight: 500, marginBottom: 8 }}>
                <input type="checkbox" checked={!!checklist[item.key]} onChange={e => setChecklist(c => ({ ...c, [item.key]: e.target.checked }))} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{item.label}</span>
              </label>
            ))}
          </fieldset>
          {notesField('Reviewer notes')}
          {warnings.length > 0 && (
            <div className="adm-warn" style={{ display: 'block' }}>
              <AlertTriangle size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> Before approving:
              {warningList(true)}
            </div>
          )}
          {!checklistComplete && <p className="adm-small" style={{ margin: 0 }}>Tick every item to approve.</p>}
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={confirm === 'reject'}
        title="Reject this claim"
        message={`This rejects ${payee}'s claim to ${prize}. No prize is paid, and a rejection cannot be undone.`}
        confirmLabel="Reject the claim"
        variant="danger"
        onConfirm={() => review('rejected')}
        onCancel={closeConfirm}
        busy={busy}
        confirmDisabled={!notesOk}
        error={modalError}
      >
        {notesField('The reason')}
      </ConfirmModal>

      <ConfirmModal
        open={confirm === 'pay'}
        title="Confirm the prize was paid"
        message={`Only confirm once ${prize} has left the account for ${payee}. This marks the bet as paid, puts it on the winners list, and records your admin id in its history.`}
        confirmLabel="Yes, the prize was paid"
        variant="success"
        busy={busy}
        confirmDisabled={payoutReference.trim().length < MIN_REFERENCE}
        error={modalError}
        onConfirm={recordPayout}
        onCancel={closeConfirm}
      >
        <div className="adm-stack">
          <dl className="adm-grid-2" style={{ margin: 0 }}>
            <div>
              <dt className="adm-small">Prize</dt>
              <dd style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600 }}>{prize}</dd>
            </div>
            <div>
              <dt className="adm-small">Paid to</dt>
              <dd style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>
                {d.userName || '—'}
                <div className="adm-small" style={{ fontWeight: 400 }}>{d.player.email || 'No email on record'}</div>
              </dd>
            </div>
          </dl>
          <label className="adm-field">
            Bank or PayFast reference
            <input
              value={payoutReference}
              onChange={e => setPayoutReference(e.target.value)}
              placeholder="e.g. FNB-2026-09-15-0042"
              maxLength={120}
              autoComplete="off"
              disabled={busy}
              className="adm-input"
            />
            <span className="adm-hint">At least {MIN_REFERENCE} characters, as it appears on the transfer.</span>
          </label>
          {warnings.length > 0 && (
            <div className="adm-warn" style={{ display: 'block' }}>
              <AlertTriangle size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> Before paying:
              {warningList(true)}
            </div>
          )}
        </div>
      </ConfirmModal>
    </div>
  )
}

/** One pair in an .adm-dl list: a label, then what is known. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

/** A fact that should make a reviewer look twice. */
function Bad({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: 'var(--red)' }}>{children}</strong>
}

const STAGES = [
  { key: 'pending', label: 'Submitted' },
  { key: 'documents_received', label: 'Documents in' },
  { key: 'under_review', label: 'Under review' },
  { key: 'approved', label: 'Approved' },
  { key: 'paid', label: 'Paid' },
] as const

/** Where the claim is: done stages in lime, the current one in green, the rest plain; a rejection ends it. */
function Timeline({ status, paid }: { status: string; paid: boolean }) {
  const rejected = status === 'rejected'
  const at = paid ? STAGES.length - 1 : STAGES.findIndex(s => s.key === status)
  const shown = rejected ? STAGES.slice(0, 3) : STAGES
  return (
    <ol aria-label="Where the claim is" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {shown.map((s, i) => {
        const done = rejected || i < at
        const current = !rejected && i === at
        return (
          <li key={s.key} className={done ? 'adm-pill adm-pill--lime' : current ? 'adm-pill adm-pill--green' : 'adm-pill'} aria-current={current ? 'step' : undefined}>
            {done && <CheckCircle size={12} aria-hidden />} {s.label}
          </li>
        )
      })}
      {rejected && <li className="adm-pill adm-pill--red" aria-current="step"><XCircle size={12} aria-hidden /> Rejected</li>}
    </ol>
  )
}
