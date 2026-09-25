import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { sendWitnessRequests } from '@/lib/claims/confirmation'

type Params = { params: Promise<{ verificationId: string }> }

const Body = z.object({
  /** One person to ask again; omit to ask everyone not yet asked. */
  witnessId: uuid.optional(),
})

/** POST — send (or re-send) confirmation requests for this claim. A new link is issued each time. */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { verificationId } = await params
  if (!uuid.safeParse(verificationId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response

  try {
    const { data: v, error } = await auth.adminClient.from('verifications').select('bet_id').eq('id', verificationId).maybeSingle()
    if (error) throw error
    if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const result = await sendWitnessRequests(auth.adminClient, v.bet_id, body.data.witnessId ? { onlyIds: [body.data.witnessId], force: true } : {})
    log.info('admin.witness_requests_sent', { admin_id: auth.user.id, verification_id: verificationId, ...result })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return apiError('admin.witness_requests_failed', err, { path: 'admin_review' })
  }
}
