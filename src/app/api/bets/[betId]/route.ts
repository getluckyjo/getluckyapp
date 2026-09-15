import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { log } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ betId: string }> }
) {
  try {
    const { betId } = await params
    const body = await request.json()
    const { status, declared_result } = body

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Validate allowed status and declared_result values
    const VALID_STATUSES = ['miss', 'claimed'] as const
    const VALID_RESULTS = ['miss', 'win'] as const

    const updates: Record<string, unknown> = {}
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      updates.status = status
    }
    if (declared_result) {
      if (!VALID_RESULTS.includes(declared_result)) {
        return NextResponse.json({ error: 'Invalid declared_result' }, { status: 400 })
      }
      updates.declared_result = declared_result
      updates.declared_at = new Date().toISOString()
    }

    const { error } = await supabase
      .from('bets')
      .update(updates)
      .eq('id', betId)
      .eq('user_id', user.id)

    if (error) {
      await alertOps({ event: 'claim.declare_failed', path: 'claim', summary: 'A result declaration could not be saved.', details: { user_id: user.id, bet_id: betId, updates }, err: error })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    log.info('claim.declared', { user_id: user.id, bet_id: betId, ...updates })
    return NextResponse.json({ success: true, source: 'database' })
  } catch (err) {
    log.error('claim.declare_unhandled', err, { path: 'claim' })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

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

    const { data: bet, error } = await supabase
      .from('bets')
      .select('*')
      .eq('id', betId)
      .eq('user_id', user.id)
      .single()

    if (error) {
      return NextResponse.json({ bet: null, error: error.message })
    }

    return NextResponse.json({ bet, source: 'database' })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
