import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePayfastConfig } from '@/lib/payfast/config'
import { cancelToken } from '@/lib/payfast/api'
import { apiError } from '@/lib/api/http'
import { log } from '@/lib/observability/log'

/**
 * GET /api/payments/card — does the caller have a saved card? The token
 * itself never leaves the server.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data, error } = await supabase.from('payment_cards').select('label, created_at, last_used_at').eq('user_id', user.id).maybeSingle()
    if (error) throw error
    return NextResponse.json({ card: data ? { label: data.label, savedAt: data.created_at, lastUsedAt: data.last_used_at } : null })
  } catch (err) {
    return apiError('payments.card.read_failed', err, { message: 'Could not check your saved card.' })
  }
}

/**
 * DELETE /api/payments/card — forget the saved card. The agreement is
 * cancelled at PayFast too, so the token can never be charged again even if
 * it were to leak; if PayFast cannot be reached the row still goes, and the
 * cancellation is logged for ops to repeat.
 */
export async function DELETE() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { data: card } = await admin.from('payment_cards').select('token').eq('user_id', user.id).maybeSingle()
    if (!card) return NextResponse.json({ removed: false })

    const cfg = resolvePayfastConfig()
    if (cfg.ok) {
      try {
        const result = await cancelToken(cfg.config, card.token)
        if (!result.ok) log.warn('payments.card.cancel_refused', { user_id: user.id, status: result.status, message: result.message })
      } catch (err) {
        log.warn('payments.card.cancel_unreachable', { user_id: user.id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    const { error } = await admin.from('payment_cards').delete().eq('user_id', user.id)
    if (error) throw error
    log.info('payments.card.removed', { user_id: user.id })
    return NextResponse.json({ removed: true })
  } catch (err) {
    return apiError('payments.card.remove_failed', err, { message: 'Could not remove your saved card. Please try again.' })
  }
}
