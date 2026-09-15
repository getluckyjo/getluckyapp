import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import {
  OPEN_VERIFICATION_STATUSES, ClaimError, assertNotSuspended, assertOpen, claimErrorResponse, transitionBet,
} from '@/lib/claims/state-machine'

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
    log.error('claim.status_unhandled', err, { path: 'claim' })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * POST — submit a hole-in-one claim.
 * Body: { certificatePath?: string, affidavitPath?: string }
 *
 * An active, in-window bet becomes `claimed` (declared win, server
 * timestamp) and a `documents_received` verification is opened. A bet that
 * is already `claimed` with an unreviewed verification may resubmit
 * documents; the same row is updated. A reviewed claim is locked (409).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ betId: string }> }
) {
  try {
    const { betId } = await params
    const { certificatePath, affidavitPath } = await request.json().catch(() => ({})) as {
      certificatePath?: unknown; affidavitPath?: unknown
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Ownership: RLS only shows the caller their own bets.
    const { data: bet } = await supabase
      .from('bets')
      .select('id, status, expires_at')
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
      if (typeof p !== 'string' || !p.startsWith(prefix) || p.includes('..')) {
        return NextResponse.json({ error: 'Invalid document path' }, { status: 400 })
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

    const now = new Date().toISOString()

    if (bet.status === 'active') {
      assertOpen(bet)
      await transitionBet(admin, {
        betId, from: 'active', to: 'claimed', actor: 'player', actorId: user.id, userId: user.id,
        extra: { declared_result: 'win', declared_at: now },
      })
    } else if (bet.status !== 'claimed') {
      throw new ClaimError('INVALID_TRANSITION', `This bet is already ${bet.status}.`, 409)
    }

    const record = {
      status: 'documents_received',
      footage_received_at: now,
      documents_received_at: now,
      updated_by: user.id,
      ...(certificatePath ? { certificate_path: certificatePath } : {}),
      ...(affidavitPath ? { affidavit_path: affidavitPath } : {}),
    }
    const { error } = existing
      ? await admin.from('verifications').update(record).eq('id', existing.id)
      : await admin.from('verifications').insert({ bet_id: betId, ...record })

    if (error) {
      await alertOps({ event: 'claim.submit_failed', path: 'claim', summary: 'A hole-in-one claim could not be recorded.', details: { user_id: user.id, bet_id: betId }, err: error })
      return NextResponse.json({ error: 'Could not record claim' }, { status: 500 })
    }

    log.info('claim.submitted', { user_id: user.id, bet_id: betId, has_certificate: !!certificatePath, has_affidavit: !!affidavitPath, resubmission: !!existing })
    return NextResponse.json({ success: true, source: 'database' })
  } catch (err) {
    const known = claimErrorResponse(err)
    if (known) return known
    log.error('claim.submit_unhandled', err, { path: 'claim' })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
