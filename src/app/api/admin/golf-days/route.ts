import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { EditableFields, adminGolfDays, setHoles } from '@/lib/golf-days/admin'
import { holesProblem } from '@/lib/golf-days/load'
import { GOLF_DAY_SLUG_PATTERN, todayInSouthAfrica } from '@/lib/golf-days/rules'

/**
 * Golf days we sponsor (migration 029). Each has its own link,
 * /golf-day/<slug>; players who join through it get the golf day tab in
 * place of Icons and one free swing on the day. No deploy involved; a
 * branded look is the one part that lives in code (src/lib/golf-days/themes.ts).
 */

const Create = z.object({
  slug: z.string().trim().toLowerCase()
    .regex(GOLF_DAY_SLUG_PATTERN, 'The link name is 2 to 40 lower-case letters, digits or dashes'),
  ...EditableFields,
  note: EditableFields.note.optional(),
}).refine(v => v.playsOn >= todayInSouthAfrica(), { message: 'The golf day cannot be in the past', path: ['playsOn'] })

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  try {
    return NextResponse.json({ data: await adminGolfDays(auth.adminClient) })
  } catch (err) {
    return apiError('admin.golf_days.list_failed', err, { path: 'admin_review' })
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const body = await parseBody(request, Create)
  if (!body.ok) return body.response
  const b = body.data

  try {
    const problem = await holesProblem(auth.adminClient, b.holeIds)
    if (problem) return NextResponse.json({ error: problem, code: 'HOLE_NOT_ELIGIBLE' }, { status: 400 })

    const { data, error } = await auth.adminClient
      .from('golf_days')
      .insert({
        slug: b.slug,
        name: b.name,
        tab_label: b.tabLabel,
        plays_on: b.playsOn,
        prize_pence: b.prizeRand * 100,
        max_players: b.maxPlayers,
        note: b.note || null,
        created_by: auth.user.id,
      })
      .select('id')
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'That link name is taken.', code: 'DUPLICATE' }, { status: 409 })
      }
      throw error
    }

    try {
      await setHoles(auth.adminClient, data.id, b.holeIds)
    } catch (holesError) {
      // Without holes the golf day is no use; take it back out rather than leave half of it.
      await auth.adminClient.from('golf_days').delete().eq('id', data.id)
      throw holesError
    }

    log.info('admin.golf_days.created', { id: data.id, slug: b.slug, plays_on: b.playsOn, prize_rand: b.prizeRand, by: auth.user.id })
    const [created] = await adminGolfDays(auth.adminClient, [data.id])
    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    return apiError('admin.golf_days.create_failed', err, { path: 'admin_review' })
  }
}
