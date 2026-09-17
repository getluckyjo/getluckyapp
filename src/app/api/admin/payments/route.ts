import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseQuery, pagination, searchTerm, boolString } from '@/lib/api/http'
import { orSearchTerm } from '@/lib/admin/data'
import { PAYMENT_SELECT, betsByReference, namesForPayments, toPaymentRecord, type PaymentRowLike } from '@/lib/admin/payments'
import type { AdminPaymentRecord, PaginatedResponse } from '@/types/admin'

const Query = pagination.extend({
  status: z.enum(['complete', 'amount_mismatch', 'pending', 'failed']).optional(),
  /** true → only payments that never became a bet: the ones needing a person. */
  unmatched: boolString.optional(),
  search: searchTerm.optional(),
})

/**
 * GET /api/admin/payments — the PayFast ledger.
 *
 * Every payment the app has recorded, newest first, with the bet it produced
 * (or the fact that it produced none). `unmatched=true` narrows to complete
 * payments with no bet, which is the queue a person has to clear.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const q = parseQuery(request.url, Query)
  if (!q.ok) return q.response
  const { status, unmatched, search, page, limit } = q.data
  const admin = auth.adminClient

  try {
    let query = admin.from('payfast_payments').select(PAYMENT_SELECT, { count: 'exact' })
    if (status) query = query.eq('status', status)
    if (unmatched === true) query = query.eq('status', 'complete').is('bet_id', null)

    if (search) {
      const s = orSearchTerm(search)
      const { data: users } = await admin.from('profiles').select('id').or(`name.ilike.*${s}*,email.ilike.*${s}*`).limit(100)
      const conds = [`m_payment_id.ilike.*${s}*`, `pf_payment_id.ilike.*${s}*`]
      const userIds = ((users ?? []) as { id: string }[]).map(u => u.id)
      if (userIds.length) conds.push(`user_id.in.(${userIds.join(',')})`)
      query = query.or(conds.join(','))
    }

    query = query.order('created_at', { ascending: false })
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
