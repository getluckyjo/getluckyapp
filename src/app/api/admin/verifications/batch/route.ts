import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { ClaimError, reviewVerification } from '@/lib/claims/state-machine'
import { log } from '@/lib/observability/log'
import type { BatchActionResult } from '@/types/admin'

const Body = z.object({
  ids: z.array(uuid).min(1).max(50),
  action: z.enum(['approve', 'reject', 'under_review']),
  notes: z.string().trim().max(1000).optional(),
})

const STATUS = { approve: 'approved', reject: 'rejected', under_review: 'under_review' } as const

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response
  const { ids, action, notes } = body.data
  const newStatus = STATUS[action]

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
