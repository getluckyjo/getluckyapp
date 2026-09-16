import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/api/http'

/**
 * GET /api/payments/pending
 *
 * The signed-in golfer's paid shots that still need recording: completed
 * payments with no bet yet, or whose bet (the ITN grants it) is still
 * active with no video. Normally empty for a few seconds only. It is not
 * empty when the browser that came back from PayFast was not the one that
 * left (an installed iOS app opens PayFast in an in-app browser with its
 * own storage), so the record screen never opened. Home shows these so
 * the golfer can pick up with one tap; nothing here creates anything.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // RLS shows the caller only their own ledger rows.
    const { data: rows, error } = await supabase
      .from('payfast_payments')
      .select('m_payment_id, tier, amount_cents, course_id, hole_id, created_at')
      .eq('user_id', user.id)
      .eq('status', 'complete')
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) throw error
    if (!rows?.length) return NextResponse.json({ pending: [] })

    // A payment is done with once its bet has a recording (or a result).
    // The ledger's bet_id link is best-effort, so match by reference.
    const refs = rows.map(r => r.m_payment_id)
    const { data: bets } = await supabase
      .from('bets')
      .select('payment_intent_id, status, video_uploaded_at')
      .in('payment_intent_id', refs)
    const recorded = new Set(
      (bets ?? []).filter(b => b.status !== 'active' || b.video_uploaded_at).map(b => b.payment_intent_id),
    )
    const open = rows.filter(r => !recorded.has(r.m_payment_id))
    if (!open.length) return NextResponse.json({ pending: [] })

    const courseIds = [...new Set(open.map(r => r.course_id).filter((v): v is string => !!v))]
    const holeIds = [...new Set(open.map(r => r.hole_id).filter((v): v is string => !!v))]
    const [{ data: courses }, { data: holes }] = await Promise.all([
      courseIds.length ? supabase.from('courses').select('id, name').in('id', courseIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      holeIds.length ? supabase.from('holes').select('id, hole_number').in('id', holeIds) : Promise.resolve({ data: [] as { id: string; hole_number: number }[] }),
    ])
    const courseName = new Map((courses ?? []).map(c => [c.id, c.name]))
    const holeNumber = new Map((holes ?? []).map(h => [h.id, h.hole_number]))

    return NextResponse.json({
      pending: open.map(r => ({
        m_payment_id: r.m_payment_id,
        tier: r.tier,
        amount_cents: r.amount_cents,
        created_at: r.created_at,
        course: r.course_id ? { id: r.course_id, name: courseName.get(r.course_id) ?? null } : null,
        hole: r.hole_id ? { id: r.hole_id, hole_number: holeNumber.get(r.hole_id) ?? null } : null,
      })),
    })
  } catch (err) {
    return apiError('payments.pending_failed', err, { message: 'Could not check for pending payments.' })
  }
}
