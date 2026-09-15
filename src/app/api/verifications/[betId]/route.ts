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

const Body = z.object({
  certificatePath: z.string().max(500).nullable().optional(),
  affidavitPath: z.string().max(500).nullable().optional(),
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

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const limited = await enforceRateLimit(RULES.claim, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited
    const body = await parseBody(request, Body)
    if (!body.ok) return body.response
    const { certificatePath, affidavitPath } = body.data

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
    return apiError('claim.submit_unhandled', err, { path: 'claim', message: 'Could not record your claim.' })
  }
}
