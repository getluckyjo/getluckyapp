import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'

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

    // Update bet status to claimed
    await supabase
      .from('bets')
      .update({ status: 'claimed', declared_result: 'win', declared_at: new Date().toISOString() })
      .eq('id', betId)
      .eq('user_id', user.id)

    // Upsert verification record
    const { error } = await supabase
      .from('verifications')
      .upsert({
        bet_id: betId,
        status: 'documents_received',
        footage_received_at: new Date().toISOString(),
        documents_received_at: new Date().toISOString(),
        ...(certificatePath ? { certificate_path: certificatePath } : {}),
        ...(affidavitPath ? { affidavit_path: affidavitPath } : {}),
      })

    if (error) {
      await alertOps({ event: 'claim.submit_failed', path: 'claim', summary: 'A hole-in-one claim could not be recorded.', details: { user_id: user.id, bet_id: betId }, err: error })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    log.info('claim.submitted', { user_id: user.id, bet_id: betId, has_certificate: !!certificatePath, has_affidavit: !!affidavitPath })
    return NextResponse.json({ success: true, source: 'database' })
  } catch (err) {
    log.error('claim.submit_unhandled', err, { path: 'claim' })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
