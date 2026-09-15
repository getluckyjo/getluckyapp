import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { HoleFieldsBase } from '@/lib/admin/schemas'

type Params = { params: Promise<{ courseId: string; holeId: string }> }

const Patch = HoleFieldsBase.partial().refine(v => Object.keys(v).length > 0, 'No valid fields to update')

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { courseId, holeId } = await params
  const body = await parseBody(request, Patch)
  if (!body.ok) return body.response

  try {
    const { data, error } = await auth.adminClient
      .from('holes')
      .update(body.data)
      .eq('id', holeId)
      .eq('course_id', courseId)
      .select('id')
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'That hole number already exists on this course', code: 'DUPLICATE_HOLE' }, { status: 409 })
      throw error
    }
    if (!data || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    log.info('admin.hole_updated', { admin_id: auth.user.id, hole_id: holeId, fields: Object.keys(body.data) })
    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError('admin.holes.update_failed', err, { path: 'admin_review' })
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { courseId, holeId } = await params

  try {
    const { count } = await auth.adminClient.from('bets').select('id', { count: 'exact', head: true }).eq('hole_id', holeId)
    if (count && count > 0) {
      return NextResponse.json({ error: 'Cannot delete a hole with existing bets; deactivate it instead', code: 'HAS_BETS' }, { status: 409 })
    }
    const { error } = await auth.adminClient.from('holes').delete().eq('id', holeId).eq('course_id', courseId)
    if (error) throw error
    log.info('admin.hole_deleted', { admin_id: auth.user.id, hole_id: holeId })
    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError('admin.holes.delete_failed', err, { path: 'admin_review' })
  }
}
