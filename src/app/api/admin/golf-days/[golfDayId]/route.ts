import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import {
  EditableFields, adminGolfDays, currentHoles, forSchedule, prizeProblem, scheduleProblem, setHoles, type ScheduledHole,
} from '@/lib/golf-days/admin'
import { GOLF_DAY_SELECT, golfDayFacts, holesProblem, playerCount, type GolfDayRow } from '@/lib/golf-days/load'

/**
 * Change a golf day: its name, tab label, dates, prize, places, holes or look, or
 * switch it off (its tab and its swing stop at once) and on again. The link
 * never changes, because it has been sent out. A swing already taken keeps
 * the prize it was taken for. A golf day nobody has joined can be deleted.
 *
 * Once a swing has been taken, a golf day cannot become a trip or a trip a
 * golf day: the one-swing rule counts them differently (migration 033).
 */

const Patch = z.object({
  name: EditableFields.name.optional(),
  tabLabel: EditableFields.tabLabel.optional(),
  playsOn: EditableFields.playsOn.optional(),
  endsOn: EditableFields.endsOn.optional(),
  prize: EditableFields.prize.optional(),
  currency: EditableFields.currency.optional(),
  maxPlayers: EditableFields.maxPlayers.optional(),
  holes: EditableFields.holes.optional(),
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
    const admin = auth.adminClient
    const { data: row, error: rowError } = await admin.from('golf_days').select(GOLF_DAY_SELECT).eq('id', golfDayId).maybeSingle()
    if (rowError) throw rowError
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const was = golfDayFacts(row as GolfDayRow)

    // The prize as it will be, checked against its currency's limit.
    const invalidPrize = prizeProblem(b.prize ?? was.prize, b.currency ?? was.currency)
    if (invalidPrize) return NextResponse.json({ error: invalidPrize, code: 'INVALID_INPUT' }, { status: 400 })

    // The schedule as it will be: dates and holes together, whichever of them changed.
    const scheduleChanged = b.playsOn !== undefined || b.endsOn !== undefined || b.holes !== undefined
    const current = scheduleChanged ? await currentHoles(admin, golfDayId) : []
    const playsOn = b.playsOn ?? was.playsOn
    const endsOn = b.endsOn !== undefined ? b.endsOn : was.endsOn
    let holes: ScheduledHole[] = []
    if (scheduleChanged) {
      holes = forSchedule(endsOn, b.holes ?? current)
      const invalid = scheduleProblem(playsOn, endsOn, holes)
      if (invalid) return NextResponse.json({ error: invalid, code: 'INVALID_INPUT' }, { status: 400 })

      if ((endsOn === null) !== (was.endsOn === null)) {
        const { count, error: swingsError } = await admin.from('bets').select('id', { count: 'exact', head: true }).eq('golf_day_id', golfDayId)
        if (swingsError) throw swingsError
        if ((count ?? 0) > 0) {
          return NextResponse.json(
            { error: `Swings have been taken, so it stays ${was.endsOn ? 'a trip' : 'a golf day of one day'}.`, code: 'GOLF_DAY_IN_USE' },
            { status: 409 },
          )
        }
      }

      // Only the holes being added are checked. One the day already has stays
      // even if its course has since stopped being a partner: the swing route
      // refuses it on the day, and the admin can take it off when they choose.
      const added = holes.filter(h => !current.some(c => c.holeId === h.holeId)).map(h => h.holeId)
      const problem = added.length ? await holesProblem(admin, added) : null
      if (problem) return NextResponse.json({ error: problem, code: 'HOLE_NOT_ELIGIBLE' }, { status: 400 })
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (b.name !== undefined) patch.name = b.name
    if (b.tabLabel !== undefined) patch.tab_label = b.tabLabel
    if (b.playsOn !== undefined) patch.plays_on = b.playsOn
    if (b.endsOn !== undefined && b.endsOn !== was.endsOn) patch.ends_on = b.endsOn
    if (b.prize !== undefined) patch.prize_pence = b.prize * 100
    if (b.currency !== undefined && b.currency !== was.currency) patch.prize_currency = b.currency
    if (b.maxPlayers !== undefined) patch.max_players = b.maxPlayers
    if (b.note !== undefined) patch.note = b.note || null
    if (b.look !== undefined) patch.look = b.look
    if (b.disabled !== undefined) patch.disabled_at = b.disabled ? new Date().toISOString() : null

    const { data, error } = await admin.from('golf_days').update(patch).eq('id', golfDayId).select('id').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (scheduleChanged) await setHoles(admin, golfDayId, holes, current)

    log.info('admin.golf_days.updated', { id: golfDayId, by: auth.user.id, fields: [...Object.keys(patch), ...(scheduleChanged ? ['holes'] : [])] })
    const [updated] = await adminGolfDays(admin, [golfDayId])
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
