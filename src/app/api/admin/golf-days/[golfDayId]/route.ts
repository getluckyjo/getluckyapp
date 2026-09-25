import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { EditableFields, adminGolfDays, currentHoleIds, setHoles } from '@/lib/golf-days/admin'
import { holesProblem, playerCount } from '@/lib/golf-days/load'

/**
 * Change a golf day: its name, tab label, date, prize, places, holes or look, or
 * switch it off (its tab and its swing stop at once) and on again. The link
 * never changes, because it has been sent out. A swing already taken keeps
 * the prize it was taken for. A golf day nobody has joined can be deleted.
 */

const Patch = z.object({
  name: EditableFields.name.optional(),
  tabLabel: EditableFields.tabLabel.optional(),
  playsOn: EditableFields.playsOn.optional(),
  prizeRand: EditableFields.prizeRand.optional(),
  maxPlayers: EditableFields.maxPlayers.optional(),
  holeIds: EditableFields.holeIds.optional(),
  note: EditableFields.note.optional(),
  look: EditableFields.look.optional(),
  disabled: z.boolean().optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'Nothing to update' })

type Ctx = { params: Promise<{ golfDayId: string }> }

const invalidId = () => NextResponse.json({ error: 'Invalid id', code: 'INVALID_INPUT' }, { status: 400 })

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { golfDayId } = await params
  if (!uuid.safeParse(golfDayId).success) return invalidId()
  const body = await parseBody(request, Patch)
  if (!body.ok) return body.response
  const b = body.data

  try {
    const current = b.holeIds ? await currentHoleIds(auth.adminClient, golfDayId) : []
    if (b.holeIds) {
      // Only the holes being added are checked. One the day already has stays
      // even if its course has since stopped being a partner: the swing route
      // refuses it on the day, and the admin can take it off when they choose.
      const added = b.holeIds.filter(id => !current.includes(id))
      const problem = added.length ? await holesProblem(auth.adminClient, added) : null
      if (problem) return NextResponse.json({ error: problem, code: 'HOLE_NOT_ELIGIBLE' }, { status: 400 })
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (b.name !== undefined) patch.name = b.name
    if (b.tabLabel !== undefined) patch.tab_label = b.tabLabel
    if (b.playsOn !== undefined) patch.plays_on = b.playsOn
    if (b.prizeRand !== undefined) patch.prize_pence = b.prizeRand * 100
    if (b.maxPlayers !== undefined) patch.max_players = b.maxPlayers
    if (b.note !== undefined) patch.note = b.note || null
    if (b.look !== undefined) patch.look = b.look
    if (b.disabled !== undefined) patch.disabled_at = b.disabled ? new Date().toISOString() : null

    const { data, error } = await auth.adminClient.from('golf_days').update(patch).eq('id', golfDayId).select('id').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (b.holeIds) await setHoles(auth.adminClient, golfDayId, b.holeIds, current)

    log.info('admin.golf_days.updated', { id: golfDayId, by: auth.user.id, fields: [...Object.keys(patch), ...(b.holeIds ? ['holes'] : [])] })
    const [updated] = await adminGolfDays(auth.adminClient, [golfDayId])
    return NextResponse.json({ data: updated })
  } catch (err) {
    return apiError('admin.golf_days.update_failed', err, { path: 'admin_review' })
  }
}

/**
 * Delete a golf day nobody has joined and nobody has swung at: one made by
 * mistake, or with a typo in its link. Otherwise it stays on record (its
 * swings point at it); switch it off instead. Its holes go with it.
 */
export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { golfDayId } = await params
  if (!uuid.safeParse(golfDayId).success) return invalidId()

  const inUse = () => NextResponse.json(
    { error: 'Players have joined this golf day, so it stays on record. Switch it off instead.', code: 'GOLF_DAY_IN_USE' },
    { status: 409 },
  )

  try {
    const admin = auth.adminClient
    const [players, swings] = await Promise.all([
      playerCount(admin, golfDayId),
      admin.from('bets').select('id', { count: 'exact', head: true }).eq('golf_day_id', golfDayId),
    ])
    if (swings.error) throw swings.error
    if (players > 0 || (swings.count ?? 0) > 0) return inUse()

    const { data, error } = await admin.from('golf_days').delete().eq('id', golfDayId).select('id')
    if (error) {
      // 23503: a swing was taken between the count and the delete (bets restrict it).
      if (error.code === '23503') return inUse()
      throw error
    }
    if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    log.info('admin.golf_days.removed', { id: golfDayId, by: auth.user.id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError('admin.golf_days.remove_failed', err, { path: 'admin_review' })
  }
}
