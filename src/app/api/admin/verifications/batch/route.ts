import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import type { BatchActionResult } from '@/types/admin'
import { ClaimError, reviewVerification } from '@/lib/claims/state-machine'
import { log } from '@/lib/observability/log'

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const body = await request.json()
    const { ids, action, notes } = body as {
      ids: string[]
      action: 'approve' | 'reject' | 'under_review'
      notes?: string
    }

    if (!ids?.length || !action) {
      return NextResponse.json({ error: 'ids and action are required' }, { status: 400 })
    }

    // Validate action is one of the allowed values
    const VALID_ACTIONS = ['approve', 'reject', 'under_review'] as const
    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    // Limit batch size to prevent DoS
    if (ids.length > 50) {
      return NextResponse.json({ error: 'Maximum 50 items per batch' }, { status: 400 })
    }

    // Validate and truncate notes
    const sanitizedNotes = notes ? String(notes).slice(0, 1000) : undefined

    const statusMap = {
      approve: 'approved',
      reject: 'rejected',
      under_review: 'under_review',
    } as const

    const newStatus = statusMap[action]

    if (auth.isMock || !auth.adminClient) {
      const results: BatchActionResult[] = ids.map(id => ({ id, success: true }))
      return NextResponse.json({ results, action, newStatus })
    }

    const results: BatchActionResult[] = []

    for (const id of ids) {
      try {
        await reviewVerification(auth.adminClient, { verificationId: String(id), to: newStatus, actorId: auth.user.id, notes: sanitizedNotes })
        results.push({ id, success: true })
      } catch (err) {
        const message = err instanceof ClaimError ? err.message : 'Processing failed'
        if (!(err instanceof ClaimError)) log.error('admin.batch_review_failed', err, { path: 'admin_review', verification_id: id })
        results.push({ id, success: false, error: message })
      }
    }
    log.info('admin.batch_review', { admin_id: auth.user.id, action, count: ids.length, failed: results.filter(r => !r.success).length })

    return NextResponse.json({ results, action, newStatus })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
