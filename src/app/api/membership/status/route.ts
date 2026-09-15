import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RULES, enforceRateLimit } from '@/lib/rate-limit'
import { log } from '@/lib/observability/log'

// ---------------------------------------------------------------------------
// GET /api/membership/status
//
// READ-ONLY membership status for the signed-in user. The Get Lucky Golf Club
// membership is owned and billed by the external funnel
// (membership.getluckygolfclub.com), which writes to the `members` / `payments`
// tables. This app NEVER writes to those tables — it only reads the caller's
// own membership row to show a Member badge + status. New signups are handed
// off to the funnel.
//
// Linkage: `members` has no auth.users foreign key, so we match the funnel's
// member record to the app user by email (case-insensitive). If a user's app
// email differs from their funnel email they'll simply read as a non-member.
// ---------------------------------------------------------------------------

// Funnel `subscription_status` values that should NOT count as an active member.
// (The exact set the funnel writes should be confirmed; anything not in here,
// on an existing member row with no cancellation date, is treated as active.)
const INACTIVE_STATUSES = new Set([
  'cancelled', 'canceled', 'expired', 'inactive', 'failed',
  'past_due', 'pending', 'none', 'unpaid', 'suspended',
])

export async function GET() {
  const notMember = { isMember: false, status: 'none', plan: null, joinedDate: null, foundingMember: false }

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json(notMember)
    }
    const limited = await enforceRateLimit(RULES.membership, { userId: user.id })
    if (limited) return limited

    let admin
    try {
      admin = createAdminClient()
    } catch (err) {
      // Service role not configured — fail safe to non-member (never error the UI), but say so.
      log.error('membership.admin_client_unavailable', err)
      return NextResponse.json(notMember)
    }

    const { data: member } = await admin
      .from('members')
      .select('subscription_status, plan_type, joined_date, cancelled_date, is_founding_member')
      .ilike('email', user.email)
      .order('joined_date', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    if (!member) {
      return NextResponse.json(notMember)
    }

    const rawStatus = String(member.subscription_status ?? '').trim().toLowerCase()
    const hasCancelled = !!member.cancelled_date
    const isMember = !INACTIVE_STATUSES.has(rawStatus) && !hasCancelled

    return NextResponse.json({
      isMember,
      status: rawStatus || 'unknown',
      plan: member.plan_type ?? null,
      joinedDate: member.joined_date ?? null,
      cancelledDate: member.cancelled_date ?? null,
      foundingMember: !!member.is_founding_member,
    })
  } catch (err) {
    log.error('membership.lookup_failed', err)
    return NextResponse.json(notMember)
  }
}
