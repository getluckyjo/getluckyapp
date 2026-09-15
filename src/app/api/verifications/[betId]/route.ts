import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import {
  OPEN_VERIFICATION_STATUSES, ClaimError, assertNotSuspended, assertOpen, claimErrorResponse, transitionBet,
} from '@/lib/claims/state-machine'
import { z } from 'zod'
import { apiError, parseBody } from '@/lib/api/http'
import { DocumentMissingError, sealDocument } from '@/lib/claims/documents'
import { WitnessesSchema, hasPlayingPartner, replaceWitnesses, witnessesForBet } from '@/lib/claims/witnesses'
import { hashIdentifier } from '@/lib/risk/hash'
import { tryRefreshClaimRisk } from '@/lib/risk/rules'
import { attachCourseContacts } from '@/lib/claims/confirmation'
import { enqueue } from '@/lib/outbox'

const Body = z.object({
  certificatePath: z.string().max(500).nullable().optional(),
  affidavitPath: z.string().max(500).nullable().optional(),
  /** Playing partners and the club official. Replaces the set on each submission while the claim is open. */
  witnesses: WitnessesSchema.optional(),
})

// GET — poll verification status
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ betId: string }> }
) {
  try {
    const { betId } = await params

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify the bet belongs to this user before returning verification data (prevent IDOR)
    const { data: bet } = await supabase
      .from('bets')
      .select('id')
      .eq('id', betId)
      .eq('user_id', user.id)
      .single()

    if (!bet) {
      return NextResponse.json({ verification: null, source: 'not_found' })
    }

    const { data: verification, error } = await supabase
      .from('verifications')
      .select('*')
      .eq('bet_id', betId)
      .single()

    if (error || !verification) {
      return NextResponse.json({ verification: null, source: 'not_found' })
    }

    return NextResponse.json({ verification, source: 'database' })
  } catch (err) {
    return apiError('claim.status_unhandled', err, { path: 'claim' })
  }
}

/**
 * POST — submit a hole-in-one claim.
 * Body: { certificatePath?, affidavitPath?, witnesses? }
 *
 * An active, in-window bet becomes `claimed` (declared win, server
 * timestamp) and a `documents_received` verification is opened. A bet that
 * is already `claimed` with an unreviewed verification may resubmit
 * documents; the same row is updated. A reviewed claim is locked (409).
 *
 * Each document is read back from storage and its hash and size recorded
 * (400 DOCUMENT_MISSING if it is not there). At least one playing partner
 * must be named, in this submission or an earlier one (400 WITNESS_REQUIRED).
 * Both checks run before the bet changes state.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ betId: string }> }
) {
  try {
    const { betId } = await params

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const limited = await enforceRateLimit(RULES.claim, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited
    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { certificatePath, affidavitPath, witnesses } = body.data

    // Ownership: RLS only shows the caller their own bets.
    const { data: bet } = await supabase
      .from('bets')
      .select('id, status, expires_at, course_id')
      .eq('id', betId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!bet) {
      return NextResponse.json({ error: 'Bet not found' }, { status: 404 })
    }

    // Evidence must live in the caller's own folder for this bet. The storage
    // policy enforces the folder on upload; this stops a path to someone
    // else's object being attached to this claim.
    const prefix = `${user.id}/${betId}/`
    for (const p of [certificatePath, affidavitPath]) {
      if (p == null) continue
      if (!p.startsWith(prefix) || p.includes('..')) {
        return NextResponse.json({ error: 'Invalid document path', code: 'INVALID_INPUT' }, { status: 400 })
      }
    }

    await assertNotSuspended(supabase, user.id)

    const admin = createAdminClient()
    const { data: existing } = await admin
      .from('verifications')
      .select('id, status')
      .eq('bet_id', betId)
      .maybeSingle()
    if (existing && !OPEN_VERIFICATION_STATUSES.includes(existing.status)) {
      throw new ClaimError('CLAIM_LOCKED', 'This claim has already been reviewed', 409)
    }

    // A resolved bet answers with its own reason before the evidence is looked at.
    if (bet.status !== 'active' && bet.status !== 'claimed') {
      throw new ClaimError('INVALID_TRANSITION', `This bet is already ${bet.status}.`, 409)
    }

    // Evidence checks, before anything changes state.
    const namedNow = witnesses ?? []
    const namedBefore = existing ? await witnessesForBet(admin, betId) : []
    if (!hasPlayingPartner(namedNow.length > 0 ? namedNow : namedBefore)) {
      return NextResponse.json({ error: 'Name at least one playing partner who saw the shot.', code: 'WITNESS_REQUIRED' }, { status: 400 })
    }
    let seals: { certificate?: { sha256: string; bytes: number }; affidavit?: { sha256: string; bytes: number } } = {}
    try {
      seals = {
        certificate: certificatePath ? await sealDocument(admin, certificatePath) : undefined,
        affidavit: affidavitPath ? await sealDocument(admin, affidavitPath) : undefined,
      }
    } catch (err) {
      if (err instanceof DocumentMissingError) {
        log.warn('claim.document_missing', { user_id: user.id, bet_id: betId, path: err.path })
        return NextResponse.json({ error: 'A document did not finish uploading. Please upload it again.', code: 'DOCUMENT_MISSING' }, { status: 400 })
      }
      throw err
    }

    const now = new Date().toISOString()
    // Where and from what the claim was made: the clustering signals for
    // the shared_ip and shared_device rules. Recorded on the first submission.
    const signals = { claim_ip_hash: hashIdentifier('ip', clientIp(request)), claim_ua_hash: hashIdentifier('ua', request.headers.get('user-agent')) }

    if (bet.status === 'active') {
      assertOpen(bet)
      await transitionBet(admin, {
        betId, from: 'active', to: 'claimed', actor: 'player', actorId: user.id, userId: user.id,
        extra: { declared_result: 'win', declared_at: now, ...signals },
      })
    } else if (bet.status === 'claimed') {
      if (!existing) {
        // Declared a win earlier, submitting documents now: this is the first submission.
        const { error: sigErr } = await admin.from('bets').update(signals).eq('id', betId).is('claim_ip_hash', null)
        if (sigErr) log.warn('claim.signals_write_failed', { bet_id: betId, error: sigErr.message })
      }
    } else {
      throw new ClaimError('INVALID_TRANSITION', `This bet is already ${bet.status}.`, 409)
    }

    const record = {
      status: 'documents_received' as const,
      footage_received_at: now,
      documents_received_at: now,
      updated_by: user.id,
      ...(certificatePath && seals.certificate
        ? { certificate_path: certificatePath, certificate_sha256: seals.certificate.sha256, certificate_bytes: seals.certificate.bytes }
        : {}),
      ...(affidavitPath && seals.affidavit
        ? { affidavit_path: affidavitPath, affidavit_sha256: seals.affidavit.sha256, affidavit_bytes: seals.affidavit.bytes }
        : {}),
    }
    const { data: saved, error } = existing
      ? await admin.from('verifications').update(record).eq('id', existing.id).select('id').single()
      : await admin.from('verifications').insert({ bet_id: betId, ...record }).select('id').single()

    if (error || !saved) {
      await alertOps({ event: 'claim.submit_failed', path: 'claim', summary: 'A hole-in-one claim could not be recorded.', details: { user_id: user.id, bet_id: betId }, err: error })
      return NextResponse.json({ error: 'Could not record claim' }, { status: 500 })
    }

    // The people to ask: those the claimant named, plus the course's standing
    // contacts. The asking happens in the outbox, not in this request. The
    // claim is recorded either way; a failure here is logged and the reviewer
    // can send again from the admin.
    try {
      if (namedNow.length > 0) await replaceWitnesses(admin, betId, saved.id, namedNow)
      await attachCourseContacts(admin, betId, saved.id, bet.course_id)
      await enqueue(admin, 'witness_request', { betId })
    } catch (err) {
      log.error('claim.witnesses_write_failed', err, { path: 'claim', user_id: user.id, bet_id: betId })
    }

    const risk = await tryRefreshClaimRisk(admin, betId)
    log.info('claim.submitted', { user_id: user.id, bet_id: betId, has_certificate: !!certificatePath, has_affidavit: !!affidavitPath, witnesses: namedNow.length, resubmission: !!existing, risk_score: risk?.score ?? null, risk_rules: risk?.flags.map(f => f.rule) ?? null })
    return NextResponse.json({ success: true, source: 'database' })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    return apiError('claim.submit_unhandled', err, { path: 'claim', message: 'Could not record your claim.' })
  }
}
