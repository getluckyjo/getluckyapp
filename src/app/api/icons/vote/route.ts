import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { log } from '@/lib/observability/log'
import { picksOpen } from '@/lib/fan-prize'

const Body = z.object({ iconId: uuid })

const closed = () => NextResponse.json({ error: 'Picks closed at first tee.', code: 'PICKS_CLOSED' }, { status: 409 })

/**
 * POST /api/icons/vote — back an Icon. One pick per golfer; picking again
 * replaces it. Only an active Icon can be picked, and only while picks are
 * open: they close at first tee, or earlier once an admin freezes the
 * backer list (migration 036 refuses the write in the database too, so a
 * stale clock here cannot let one through). Writes go through the service
 * role (golfers have no write policy on icon_votes); the user id comes
 * from the session, never the body.
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
    const [{ data: icon }, { data: event }] = await Promise.all([
      admin.from('icons').select('id, is_active').eq('id', body.data.iconId).maybeSingle(),
      admin.from('icon_events').select('first_tee_at, frozen_at').order('created_at', { ascending: true }).limit(1).maybeSingle(),
    ])
    if (!icon || !icon.is_active) {
      return NextResponse.json({ error: 'That Icon is not in the field', code: 'ICON_NOT_FOUND' }, { status: 404 })
    }
    if (!picksOpen(event)) return closed()

    const { error } = await admin
      .from('icon_votes')
      .upsert({ user_id: user.id, icon_id: icon.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) {
      if (error.message?.includes('ICON_PICKS_CLOSED')) return closed()
      throw error
    }

    log.info('icons.backed', { user_id: user.id, icon_id: icon.id })
    return NextResponse.json({ ok: true, myVote: icon.id })
  } catch (err) {
    return apiError('icons.vote_failed', err, { message: 'Could not save your pick. Please try again.' })
  }
}
