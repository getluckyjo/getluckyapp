import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, invalidInput, parseBody, uuid } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { CourseFieldsBase } from '@/lib/admin/schemas'

type Params = { params: Promise<{ courseId: string }> }

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { courseId } = await params
  if (!uuid.safeParse(courseId).success) return notFound()
  const admin = auth.adminClient

  try {
    // One round trip: all three are keyed by the course id alone.
    const [courseRes, holesRes, contactsRes] = await Promise.all([
      admin.from('courses').select('*').eq('id', courseId).maybeSingle(),
      admin.from('holes').select('*').eq('course_id', courseId).order('hole_number', { ascending: true }),
      admin.from('course_contacts').select('id, name, email, role, created_at').eq('course_id', courseId).order('created_at', { ascending: true }),
    ])
    if (courseRes.error) throw courseRes.error
    if (holesRes.error) throw holesRes.error
    if (contactsRes.error) throw contactsRes.error
    if (!courseRes.data) return notFound()

    return NextResponse.json({ course: courseRes.data, holes: holesRes.data ?? [], contacts: contactsRes.data ?? [] })
  } catch (err) {
    return apiError('admin.courses.detail_failed', err, { path: 'admin_review' })
  }
}

const Patch = CourseFieldsBase.partial().refine(v => Object.keys(v).length > 0, 'No valid fields to update')

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { courseId } = await params
  if (!uuid.safeParse(courseId).success) return notFound()
  const body = await parseBody(request, Patch)
  if (!body.ok) return body.response
  // Coordinates move together: a latitude without a longitude places nothing.
  const { lat, lng } = body.data
  if ((lat === undefined) !== (lng === undefined) || (lat === null) !== (lng === null)) {
    return invalidInput([{ path: 'lng', message: 'Give both latitude and longitude, or neither' }])
  }

  try {
    const { data, error } = await auth.adminClient.from('courses').update(body.data).eq('id', courseId).select('id')
    if (error) throw error
    if (!data || data.length === 0) return notFound()
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
  if (!uuid.safeParse(courseId).success) return notFound()

  try {
    const { count, error: countErr } = await auth.adminClient.from('bets').select('id', { count: 'exact', head: true }).eq('course_id', courseId)
    if (countErr) throw countErr
    if (count && count > 0) {
      return NextResponse.json({
        error: `This course has ${count} bet${count === 1 ? '' : 's'}, so it cannot be deleted. End the partnership instead: golfers can then no longer pay to play there.`,
        code: 'HAS_BETS',
      }, { status: 409 })
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
