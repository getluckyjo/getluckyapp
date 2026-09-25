import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { ClaimError, reviewVerification } from '@/lib/claims/state-machine'
import { MIN_DECISION_NOTES } from '@/lib/claims/checklist'
import { log } from '@/lib/observability/log'
import type { BatchActionResult } from '@/types/admin'

const Body = z.object({
  ids: z.array(uuid).min(1).max(50),
  // 'approve' is still recognised so an old client gets a reason, not a schema error.
  action: z.enum(['approve', 'reject', 'under_review']),
  notes: z.string().trim().max(1000).optional(),
})

const STATUS = { reject: 'rejected', under_review: 'under_review' } as const

/**
 * POST — reject, or mark under review, several claims at once. Each claim is
 * tried on its own; `results` says which went through and why the others did
 * not. Approving is never batched: it pays out, so it goes through each
 * claim's own checklist on its review page.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response
  const { ids, action, notes } = body.data
  if (action === 'approve') {
    return NextResponse.json({ error: 'Claims are approved one at a time, on each claim\'s own page, with its checklist.', code: 'BATCH_APPROVE_NOT_ALLOWED' }, { status: 400 })
  }
  const newStatus = STATUS[action]
  if (action === 'reject' && (notes ?? '').length < MIN_DECISION_NOTES) {
    return NextResponse.json({ error: `Say why, in at least ${MIN_DECISION_NOTES} characters. The reason is part of the record for every claim in the batch.`, code: 'NOTES_REQUIRED' }, { status: 400 })
  }

  try {
    const results: BatchActionResult[] = []
    for (const id of ids) {
      try {
        await reviewVerification(auth.adminClient, { verificationId: id, to: newStatus, actorId: auth.user.id, notes })
        results.push({ id, success: true })
      } catch (err) {
        if (err instanceof ClaimError) {
          results.push({ id, success: false, error: err.message })
        } else {
          log.error('admin.batch_review_item_failed', err, { path: 'admin_review', verification_id: id })
          results.push({ id, success: false, error: 'Processing failed' })
        }
      }
    }
    log.info('admin.batch_review', { admin_id: auth.user.id, action, count: ids.length, failed: results.filter(r => !r.success).length })
    return NextResponse.json({ results, action, newStatus })
  } catch (err) {
    return apiError('admin.batch_review_failed', err, { path: 'admin_review' })
  }
}
