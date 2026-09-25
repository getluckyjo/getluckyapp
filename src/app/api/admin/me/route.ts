/**
 * GET /api/admin/me
 * Returns: { name, email, claimsToReview }
 *
 * The admin's gate and the sidebar's badge, and nothing else: who is signed
 * in, and how many claims are waiting on a reviewer (documents in, or under
 * review). The layout asks on every page change and when the window comes
 * back into focus, so the badge follows the queue. The dashboard's heavy
 * totals stay on /api/admin/stats.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError } from '@/lib/api/http'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const admin = auth.adminClient

  try {
    const [profile, claims] = await Promise.all([
      admin.from('profiles').select('name').eq('id', auth.user.id).maybeSingle(),
      admin.from('verifications').select('id', { count: 'exact', head: true }).in('status', ['documents_received', 'under_review']),
    ])
    if (claims.error) throw claims.error
    return NextResponse.json({
      name: profile.data?.name || 'Admin',
      email: auth.user.email ?? '',
      claimsToReview: claims.count ?? 0,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return apiError('admin.me_failed', err, { path: 'admin_review' })
  }
}
