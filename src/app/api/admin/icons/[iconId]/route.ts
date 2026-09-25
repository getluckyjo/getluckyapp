import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { log } from '@/lib/observability/log'

const Patch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  team: z.enum(['rsa', 'world']).optional(),
  isCaptain: z.boolean().optional(),
  tagline: z.string().trim().max(120).nullable().optional(),
  photoUrl: z.url().max(500).nullable().optional(),
  // An emptied box is "no change", not 0 (z.coerce reads '' as 0).
  sortOrder: z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.coerce.number().int().min(0).max(10000).optional()),
  isActive: z.boolean().optional(),
}).refine(v => Object.values(v).some(x => x !== undefined), { message: 'Nothing to update' })

type Ctx = { params: Promise<{ iconId: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { iconId } = await params
  if (!uuid.safeParse(iconId).success) return NextResponse.json({ error: 'Invalid id', code: 'INVALID_INPUT' }, { status: 400 })
  const body = await parseBody(request, Patch)
  if (!body.ok) return body.response
  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.data.name !== undefined) patch.name = body.data.name
    if (body.data.team !== undefined) patch.team = body.data.team
    if (body.data.isCaptain !== undefined) patch.is_captain = body.data.isCaptain
    if (body.data.tagline !== undefined) patch.tagline = body.data.tagline || null
    if (body.data.photoUrl !== undefined) patch.photo_url = body.data.photoUrl || null
    if (body.data.sortOrder !== undefined) patch.sort_order = body.data.sortOrder
    if (body.data.isActive !== undefined) patch.is_active = body.data.isActive
    const { data, error } = await auth.adminClient
      .from('icons')
      .update(patch)
      .eq('id', iconId)
      .select('id, name, team, is_captain, tagline, photo_url, sort_order, is_active, created_at')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    log.info('admin.icons.updated', { id: iconId, by: auth.user.id, fields: Object.keys(patch) })
    return NextResponse.json({ data })
  } catch (err) {
    return apiError('admin.icons.update_failed', err)
  }
}

/** Deleting an Icon removes every pick for it (cascade). Prefer deactivating. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { iconId } = await params
  if (!uuid.safeParse(iconId).success) return NextResponse.json({ error: 'Invalid id', code: 'INVALID_INPUT' }, { status: 400 })
  try {
    const { data, error } = await auth.adminClient.from('icons').delete().eq('id', iconId).select('id')
    if (error) throw error
    if (!data || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    log.info('admin.icons.removed', { id: iconId, by: auth.user.id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError('admin.icons.remove_failed', err)
  }
}
