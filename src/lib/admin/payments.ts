/**
 * The PayFast ledger, as the admin screens read it.
 *
 * payfast_payments is the money record: one row per payment, written by the
 * ITN or by a saved-card charge. A row with `status: 'complete'` and no bet
 * is the case that needs a person — the golfer paid and has nothing to show
 * for it — so both the payments list and the bet screen surface it plainly.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminPaymentRecord, BetTier } from '@/types/admin'

export const PAYMENT_SELECT =
  'm_payment_id, pf_payment_id, user_id, course_id, hole_id, tier, amount_cents, status, bet_id, raw_payload, created_at'

export interface PaymentRowLike {
  m_payment_id: string
  pf_payment_id: string | null
  user_id: string | null
  course_id: string | null
  hole_id: string | null
  tier: BetTier | null
  amount_cents: number
  status: 'complete' | 'amount_mismatch' | 'pending' | 'failed'
  bet_id: string | null
  raw_payload: unknown
  created_at: string
}

/** A saved-card charge writes `{ source: 'saved_card' }`; an ITN writes PayFast's own form. */
function sourceOf(raw: unknown): 'saved_card' | 'checkout' {
  return raw && typeof raw === 'object' && (raw as { source?: string }).source === 'saved_card' ? 'saved_card' : 'checkout'
}

export interface PaymentNames {
  users: Map<string, { name: string | null; email: string | null }>
  courses: Map<string, string>
  holes: Map<string, number>
}

const unique = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((x): x is string => !!x))]

/** Names for a page of payments, in three queries. */
export async function namesForPayments(admin: SupabaseClient, rows: PaymentRowLike[]): Promise<PaymentNames> {
  const userIds = unique(rows.map(r => r.user_id))
  const courseIds = unique(rows.map(r => r.course_id))
  const holeIds = unique(rows.map(r => r.hole_id))

  const [profiles, courses, holes] = await Promise.all([
    userIds.length ? admin.from('profiles').select('id, name, email').in('id', userIds) : Promise.resolve({ data: [] as { id: string; name: string | null; email: string | null }[] }),
    courseIds.length ? admin.from('courses').select('id, name').in('id', courseIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    holeIds.length ? admin.from('holes').select('id, hole_number').in('id', holeIds) : Promise.resolve({ data: [] as { id: string; hole_number: number }[] }),
  ])

  return {
    users: new Map((profiles.data ?? []).map((p: { id: string; name: string | null; email: string | null }) => [p.id, { name: p.name, email: p.email }])),
    courses: new Map((courses.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name])),
    holes: new Map((holes.data ?? []).map((h: { id: string; hole_number: number }) => [h.id, h.hole_number])),
  }
}

export function toPaymentRecord(r: PaymentRowLike, names: PaymentNames): AdminPaymentRecord {
  const user = r.user_id ? names.users.get(r.user_id) : undefined
  return {
    mPaymentId: r.m_payment_id,
    pfPaymentId: r.pf_payment_id,
    userId: r.user_id,
    userName: user?.name ?? null,
    userEmail: user?.email ?? null,
    courseName: r.course_id ? names.courses.get(r.course_id) ?? null : null,
    holeNumber: r.hole_id ? names.holes.get(r.hole_id) ?? null : null,
    tier: r.tier,
    amountCents: r.amount_cents,
    status: r.status,
    betId: r.bet_id,
    source: sourceOf(r.raw_payload),
    createdAt: r.created_at,
  }
}

/**
 * The bet each unlinked payment actually produced, keyed by reference.
 *
 * `bet_id` on the ledger row is best-effort — it is written after the bet
 * exists and a failed link is only logged — so a row without it may still
 * have a bet, found by the reference the bet carries. Whatever is missing
 * from this map after the lookup is a payment with no bet: the golfer paid
 * and has nothing to show for it, which is the one case needing a person.
 */
export async function betsByReference(admin: SupabaseClient, rows: PaymentRowLike[]): Promise<Map<string, string>> {
  const unlinked = rows.filter(r => !r.bet_id).map(r => r.m_payment_id)
  if (!unlinked.length) return new Map()
  const { data } = await admin.from('bets').select('id, payment_intent_id').in('payment_intent_id', unlinked)
  return new Map(
    ((data ?? []) as { id: string; payment_intent_id: string | null }[])
      .filter(b => b.payment_intent_id)
      .map(b => [b.payment_intent_id as string, b.id]),
  )
}
