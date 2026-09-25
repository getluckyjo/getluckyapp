import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseQuery, pagination, boolString } from '@/lib/api/http'
import { PAYMENT_SELECT, betsByReference, namesForPayments, toPaymentRecord, type PaymentRowLike } from '@/lib/admin/payments'
import type { AdminPaymentRecord, PaginatedResponse } from '@/types/admin'
import { paymentFilters, paymentSearchConditions, paymentsSource } from './filters'

const Query = pagination.extend({
  ...paymentFilters,
  /** true → only payments that took money and never became a bet: the ones needing a person. */
  unmatched: boolString.optional(),
})

/**
 * GET /api/admin/payments — the PayFast ledger.
 *
 * Every payment the app has recorded, newest first, with the bet it produced
 * (or the fact that it produced none). `unmatched=true` reads migration 032's
 * admin_unmatched_payments view instead: complete or amount_mismatch, and no
 * bet by either link, which is the queue a person has to clear. A status
 * narrows either one.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const q = parseQuery(request.url, Query)
  if (!q.ok) return q.response
  const { status, unmatched, search, page, limit } = q.data
  const admin = auth.adminClient

  try {
    let query = admin.from(paymentsSource(unmatched)).select(PAYMENT_SELECT, { count: 'exact' })
    if (status) query = query.eq('status', status)
    if (search) query = query.or((await paymentSearchConditions(admin, search)).join(','))

    // The reference breaks ties, so a payment cannot appear on two pages or on none.
    query = query.order('created_at', { ascending: false }).order('m_payment_id')
    const offset = (page - 1) * limit
    const { data, count, error } = await query.range(offset, offset + limit - 1)
    if (error) throw error

    const rows = (data ?? []) as PaymentRowLike[]
    const [names, byReference] = await Promise.all([
      namesForPayments(admin, rows),
      betsByReference(admin, rows),
    ])
    // The ledger's bet_id link is best-effort, so fall back to the reference
    // the bet itself carries. Still null means: paid, no bet.
    const records: AdminPaymentRecord[] = rows.map(r => {
      const record = toPaymentRecord(r, names)
      return record.betId ? record : { ...record, betId: byReference.get(r.m_payment_id) ?? null }
    })

    const total = count ?? records.length
    const resp: PaginatedResponse<AdminPaymentRecord> = { data: records, total, page, limit, totalPages: Math.ceil(total / limit) }
    return NextResponse.json(resp)
  } catch (err) {
    return apiError('admin.payments.list_failed', err, { path: 'admin_review' })
  }
}
