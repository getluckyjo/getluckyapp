import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { apiError } from '@/lib/api/http'
import { deleteAccount, deletionStatus, type DeletionBlock } from '@/lib/account/delete'

const BLOCK_MESSAGES: Record<DeletionBlock, string> = {
  ACCOUNT_SUSPENDED: 'This account is suspended. Please contact support to close it.',
  CLAIM_OPEN: 'You have a claim under review or a paid prize on record. Those records must be kept, so support has to close this account for you.',
}

/**
 * GET /api/account — can this account be deleted, and what would it forfeit?
 * Read by the account page before it shows the confirmation.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const status = await deletionStatus(createAdminClient(), user.id)
    return NextResponse.json({
      canDelete: status.canDelete,
      reason: status.reason,
      message: status.reason ? BLOCK_MESSAGES[status.reason] : null,
      activeBets: status.activeBets,
    })
  } catch (err) {
    return apiError('account.status_unhandled', err)
  }
}

/**
 * DELETE /api/account — delete the caller's own account.
 * No body: the session is the only input, and there is nothing to choose.
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const limited = await enforceRateLimit(RULES.accountDelete, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited

    const outcome = await deleteAccount(createAdminClient(), user.id)
    if (!outcome.ok) {
      return NextResponse.json({ error: BLOCK_MESSAGES[outcome.reason], code: outcome.reason }, { status: 409 })
    }
    return NextResponse.json({ ok: true, ...outcome.result })
  } catch (err) {
    return apiError('account.delete_unhandled', err, { message: 'Your account could not be deleted. Nothing has been removed; please try again.' })
  }
}
