import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, uuid } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { HoleFields } from '@/lib/admin/schemas'

type Params = { params: Promise<{ courseId: string }> }

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { courseId } = await params

  try {
    const { data, error } = await auth.adminClient
      .from('holes')
      .select('*')
      .eq('course_id', courseId)
      .order('hole_number', { ascending: true })
    if (error) throw error
    return NextResponse.json({ holes: data ?? [] })
  } catch (err) {
    return apiError('admin.holes.list_failed', err, { path: 'admin_review' })
  }
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { courseId } = await params
  if (!uuid.safeParse(courseId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await parseBody(request, HoleFields)
  if (!body.ok) return body.response

  try {
    const { data, error } = await auth.adminClient
      .from('holes')
      .insert({ course_id: courseId, ...body.data, distance_metres: body.data.distance_metres ?? null })
      .select('id')
      .single()
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: `Hole ${body.data.hole_number} is already on this course. Edit that one instead.`, code: 'DUPLICATE_HOLE' }, { status: 409 })
      if (error.code === '23503') return NextResponse.json({ error: 'Not found' }, { status: 404 })
      throw error
    }
    log.info('admin.hole_created', { admin_id: auth.user.id, course_id: courseId, hole_id: data.id })
    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    return apiError('admin.holes.create_failed', err, { path: 'admin_review' })
  }
}
