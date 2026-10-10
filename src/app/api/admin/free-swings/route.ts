/**
 * GET  /api/admin/free-swings
 * PATCH /api/admin/free-swings  Body: { dailyCap?, paused? }
 * Returns: { data: { dailyCap, paused, usedToday, open, envPaused, updatedAt } }
 *
 * The daily cap on free swings and the pause switch (migration 038), as the
 * card on the dashboard reads and sets them. `envPaused` says whether
 * FREE_SWING_PAUSED=on is set in the environment, which the admin cannot
 * change from here: that switch is for when the database is the problem.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { envPaused, readFreeSwingCap } from '@/lib/free-swing-cap'

const Patch = z.object({
  dailyCap: z.coerce.number().int().min(0).max(100000).optional(),
  paused: z.boolean().optional(),
}).refine(v => v.dailyCap !== undefined || v.paused !== undefined, { message: 'Nothing to update' })

async function answer(admin: Parameters<typeof readFreeSwingCap>[0]) {
  const status = await readFreeSwingCap(admin)
  return NextResponse.json({ data: { ...status, envPaused: envPaused() } })
}

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  try {
    return await answer(auth.adminClient)
  } catch (err) {
    return apiError('admin.free_swings.read_failed', err, { path: 'admin_review' })
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const body = await parseBody(request, Patch)
  if (!body.ok) return body.response
  const b = body.data

  try {
    const admin = auth.adminClient
    const change = {
      ...(b.dailyCap !== undefined ? { daily_cap: b.dailyCap } : {}),
      ...(b.paused !== undefined ? { paused: b.paused } : {}),
      updated_by: auth.user.id,
      updated_at: new Date().toISOString(),
    }
    const { data: updated, error } = await admin.from('free_swing_caps').update(change).eq('id', 1).select('id').maybeSingle()
    if (error) throw error
    if (!updated) {
      // The row migration 038 seeds is not there: make it, with these values.
      const { error: insertError } = await admin.from('free_swing_caps').insert({ id: 1, ...change })
      if (insertError) throw insertError
    }
    log.info('admin.free_swings.updated', { daily_cap: b.dailyCap, paused: b.paused, by: auth.user.id })
    return await answer(admin)
  } catch (err) {
    return apiError('admin.free_swings.update_failed', err, { path: 'admin_review' })
  }
}
