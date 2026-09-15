import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import { createAdminClient } from '@/lib/supabase/admin'

// GET — poll verification status
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ betId: string }> }
) {
  try {
    const { betId } = await params

    if (betId.startsWith('bet_mock') || betId.startsWith('bet_fallback')) {
      return NextResponse.json({ verification: null, source: 'mock' })
    }

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

// POST — submit claim (create/update verification record)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ betId: string }> }
) {
  try {
    const { betId } = await params
    const { certificatePath, affidavitPath } = await request.json()

    if (betId.startsWith('bet_mock') || betId.startsWith('bet_fallback')) {
      return NextResponse.json({ success: true, source: 'mock' })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Ownership: RLS only shows the caller their own bets.
    const { data: bet } = await supabase
      .from('bets')
      .select('id, status')
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

    const admin = createAdminClient()

    // A claim that has been reviewed cannot be resubmitted from the browser.
    // (The full state machine lands in Batch 2; this is the minimum so the
    // service-role write cannot be used to reopen a rejection.)
    const { data: existing } = await admin
      .from('verifications')
      .select('id, status')
      .eq('bet_id', betId)
      .maybeSingle()
    if (existing && !['pending', 'documents_received'].includes(String(existing.status))) {
      return NextResponse.json({ error: 'This claim has already been reviewed', code: 'CLAIM_LOCKED' }, { status: 409 })
    }

    const now = new Date().toISOString()
    const { error: betErr } = await admin
      .from('bets')
      .update({ status: 'claimed', declared_result: 'win', declared_at: now })
      .eq('id', betId)
      .eq('user_id', user.id)
    if (betErr) {
      await alertOps({ event: 'claim.bet_update_failed', path: 'claim', summary: 'Could not mark a bet as claimed.', details: { user_id: user.id, bet_id: betId }, err: betErr })
      return NextResponse.json({ error: 'Could not record claim' }, { status: 500 })
    }

    const record = {
      status: 'documents_received',
      footage_received_at: now,
      documents_received_at: now,
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

    log.info('claim.submitted', { user_id: user.id, bet_id: betId, has_certificate: !!certificatePath, has_affidavit: !!affidavitPath })
    return NextResponse.json({ success: true, source: 'database' })
  } catch (err) {
    log.error('claim.submit_unhandled', err, { path: 'claim' })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
