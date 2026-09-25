import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody } from '@/lib/api/http'
import { log } from '@/lib/observability/log'

/** The field for Back an Icon, with live pick counts. Edited without a deploy. */

const Create = z.object({
  name: z.string().trim().min(1).max(80),
  team: z.enum(['rsa', 'world']).default('rsa'),
  isCaptain: z.boolean().optional(),
  tagline: z.string().trim().max(120).optional(),
  photoUrl: z.url().max(500).optional(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
})

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const admin = auth.adminClient
  try {
    const [iconsRes, totalRes] = await Promise.all([
      admin.from('icons').select('id, name, team, is_captain, tagline, photo_url, sort_order, is_active, created_at').order('team').order('sort_order').order('name'),
      admin.from('icon_votes').select('icon_id', { count: 'exact', head: true }),
    ])
    if (iconsRes.error) throw iconsRes.error
    if (totalRes.error) throw totalRes.error
    const icons = (iconsRes.data ?? []) as { id: string }[]

    // A head count per Icon: exact at any size, where reading the icon_votes
    // rows stopped counting at PostgREST's 1,000-row cap. The field is tens.
    const counts = await Promise.all(icons.map(i => admin.from('icon_votes').select('icon_id', { count: 'exact', head: true }).eq('icon_id', i.id)))
    for (const c of counts) if (c.error) throw c.error

    return NextResponse.json({
      data: icons.map((i, n) => ({ ...i, votes: counts[n].count ?? 0 })),
      totalVotes: totalRes.count ?? 0,
    })
  } catch (err) {
    return apiError('admin.icons.list_failed', err)
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const body = await parseBody(request, Create)
  if (!body.ok) return body.response
  try {
    const { data, error } = await auth.adminClient
      .from('icons')
      .insert({
        name: body.data.name,
        team: body.data.team,
        is_captain: body.data.isCaptain ?? false,
        tagline: body.data.tagline || null,
        photo_url: body.data.photoUrl || null,
        sort_order: body.data.sortOrder ?? 100,
        is_active: true,
        created_by: auth.user.id,
      })
      .select('id, name, team, is_captain, tagline, photo_url, sort_order, is_active, created_at')
      .single()
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'That name is already in the field.', code: 'DUPLICATE' }, { status: 409 })
      throw error
    }
    log.info('admin.icons.added', { id: data.id, by: auth.user.id })
    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    return apiError('admin.icons.add_failed', err)
  }
}
