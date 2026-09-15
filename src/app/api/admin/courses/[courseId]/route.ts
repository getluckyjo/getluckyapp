import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { CourseFieldsBase } from '@/lib/admin/schemas'

type Params = { params: Promise<{ courseId: string }> }

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { courseId } = await params
  if (!uuid.safeParse(courseId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const { data: course, error } = await auth.adminClient.from('courses').select('*').eq('id', courseId).maybeSingle()
    if (error) throw error
    if (!course) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: holes, error: holesErr } = await auth.adminClient
      .from('holes')
      .select('*')
      .eq('course_id', courseId)
      .order('hole_number', { ascending: true })
    if (holesErr) throw holesErr

    const { data: contacts, error: contactsErr } = await auth.adminClient
      .from('course_contacts')
      .select('id, name, email, role, created_at')
      .eq('course_id', courseId)
      .order('created_at', { ascending: true })
    if (contactsErr) throw contactsErr

    return NextResponse.json({ course, holes: holes ?? [], contacts: contacts ?? [] })
  } catch (err) {
    return apiError('admin.courses.detail_failed', err, { path: 'admin_review' })
  }
}

const Patch = CourseFieldsBase.partial().refine(v => Object.keys(v).length > 0, 'No valid fields to update')

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { courseId } = await params
  const body = await parseBody(request, Patch)
  if (!body.ok) return body.response

  try {
    const { data, error } = await auth.adminClient.from('courses').update(body.data).eq('id', courseId).select('id')
    if (error) throw error
    if (!data || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    log.info('admin.course_updated', { admin_id: auth.user.id, course_id: courseId, fields: Object.keys(body.data) })
    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError('admin.courses.update_failed', err, { path: 'admin_review' })
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { courseId } = await params

  try {
    const { count } = await auth.adminClient.from('bets').select('id', { count: 'exact', head: true }).eq('course_id', courseId)
    if (count && count > 0) {
      return NextResponse.json({ error: 'Cannot delete a course with existing bets', code: 'HAS_BETS' }, { status: 409 })
    }

    const { error: holesErr } = await auth.adminClient.from('holes').delete().eq('course_id', courseId)
    if (holesErr) throw holesErr
    const { error } = await auth.adminClient.from('courses').delete().eq('id', courseId)
    if (error) throw error

    log.info('admin.course_deleted', { admin_id: auth.user.id, course_id: courseId })
    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError('admin.courses.delete_failed', err, { path: 'admin_review' })
  }
}
