import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { log } from '@/lib/observability/log'

const Body = z.object({ iconId: uuid })

/**
 * POST /api/icons/vote — back an Icon. One pick per golfer; picking again
 * replaces it. Only an active Icon can be picked. Writes go through the
 * service role (golfers have no write policy on icon_votes); the user id
 * comes from the session, never the body.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in to back an Icon', code: 'UNAUTHENTICATED' }, { status: 401 })

    const limited = await enforceRateLimit(RULES.iconVote, { userId: user.id, ip: clientIp(request) })
    if (limited) return limited
    const body = await parseBody(request, Body)
    if (!body.ok) return body.response

    const admin = createAdminClient()
    const { data: icon } = await admin.from('icons').select('id, is_active').eq('id', body.data.iconId).maybeSingle()
    if (!icon || !icon.is_active) {
      return NextResponse.json({ error: 'That Icon is not in the field', code: 'ICON_NOT_FOUND' }, { status: 404 })
    }

    const { error } = await admin
      .from('icon_votes')
      .upsert({ user_id: user.id, icon_id: icon.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) throw error

    log.info('icons.backed', { user_id: user.id, icon_id: icon.id })
    return NextResponse.json({ ok: true, myVote: icon.id })
  } catch (err) {
    return apiError('icons.vote_failed', err, { message: 'Could not save your pick. Please try again.' })
  }
}
