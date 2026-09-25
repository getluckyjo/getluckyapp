import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { EditableFields, adminGolfDays, setHoles } from '@/lib/golf-days/admin'
import { holesProblem } from '@/lib/golf-days/load'

/**
 * Change a golf day: its name, tab label, date, prize, places or holes, or
 * switch it off (its tab and its swing stop at once) and on again. The link
 * never changes, because it has been sent out. A swing already taken keeps
 * the prize it was taken for.
 */

const Patch = z.object({
  name: EditableFields.name.optional(),
  tabLabel: EditableFields.tabLabel.optional(),
  playsOn: EditableFields.playsOn.optional(),
  prizeRand: EditableFields.prizeRand.optional(),
  maxPlayers: EditableFields.maxPlayers.optional(),
  holeIds: EditableFields.holeIds.optional(),
  note: EditableFields.note.optional(),
  disabled: z.boolean().optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'Nothing to update' })

type Ctx = { params: Promise<{ golfDayId: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { golfDayId } = await params
  if (!uuid.safeParse(golfDayId).success) return NextResponse.json({ error: 'Invalid id', code: 'INVALID_INPUT' }, { status: 400 })
  const body = await parseBody(request, Patch)
  if (!body.ok) return body.response
  const b = body.data

  try {
    if (b.holeIds) {
      const problem = await holesProblem(auth.adminClient, b.holeIds)
      if (problem) return NextResponse.json({ error: problem, code: 'HOLE_NOT_ELIGIBLE' }, { status: 400 })
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (b.name !== undefined) patch.name = b.name
    if (b.tabLabel !== undefined) patch.tab_label = b.tabLabel
    if (b.playsOn !== undefined) patch.plays_on = b.playsOn
    if (b.prizeRand !== undefined) patch.prize_pence = b.prizeRand * 100
    if (b.maxPlayers !== undefined) patch.max_players = b.maxPlayers
    if (b.note !== undefined) patch.note = b.note || null
    if (b.disabled !== undefined) patch.disabled_at = b.disabled ? new Date().toISOString() : null

    const { data, error } = await auth.adminClient.from('golf_days').update(patch).eq('id', golfDayId).select('id').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (b.holeIds) await setHoles(auth.adminClient, golfDayId, b.holeIds)

    log.info('admin.golf_days.updated', { id: golfDayId, by: auth.user.id, fields: [...Object.keys(patch), ...(b.holeIds ? ['holes'] : [])] })
    const [updated] = await adminGolfDays(auth.adminClient, [golfDayId])
    return NextResponse.json({ data: updated })
  } catch (err) {
    return apiError('admin.golf_days.update_failed', err, { path: 'admin_review' })
  }
}
