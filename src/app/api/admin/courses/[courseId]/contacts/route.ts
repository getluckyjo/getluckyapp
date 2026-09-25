import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, parseQuery, uuid } from '@/lib/api/http'
import { log } from '@/lib/observability/log'

type Params = { params: Promise<{ courseId: string }> }

const Body = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().max(200).pipe(z.email()),
})

/** POST — add a standing club contact. Every future claim at the course asks them to confirm the certificate. */
export async function POST(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { courseId } = await params
  if (!uuid.safeParse(courseId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response

  try {
    const [courseRes, dupRes] = await Promise.all([
      auth.adminClient.from('courses').select('id').eq('id', courseId).maybeSingle(),
      auth.adminClient.from('course_contacts').select('id').eq('course_id', courseId).eq('email', body.data.email).limit(1),
    ])
    if (courseRes.error) throw courseRes.error
    if (dupRes.error) throw dupRes.error
    if (!courseRes.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (dupRes.data?.length) return NextResponse.json({ error: 'That email is already a contact for this course', code: 'DUPLICATE' }, { status: 409 })
    const { data, error } = await auth.adminClient
      .from('course_contacts')
      .insert({ course_id: courseId, name: body.data.name, email: body.data.email })
      .select('id, name, email, role, created_at')
      .single()
    if (error) throw error
    log.info('admin.course_contact_added', { admin_id: auth.user.id, course_id: courseId, contact_id: data.id })
    return NextResponse.json({ success: true, contact: data })
  } catch (err) {
    return apiError('admin.course_contacts.add_failed', err, { path: 'admin_review' })
  }
}

const DeleteQuery = z.object({ id: uuid })

/** DELETE ?id= — remove a contact. Requests already sent for open claims are unaffected. */
export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { courseId } = await params
  if (!uuid.safeParse(courseId).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const q = parseQuery(request.url, DeleteQuery)
  if (!q.ok) return q.response

  try {
    const { data, error } = await auth.adminClient.from('course_contacts').delete().eq('id', q.data.id).eq('course_id', courseId).select('id')
    if (error) throw error
    if (!data || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    log.info('admin.course_contact_removed', { admin_id: auth.user.id, course_id: courseId, contact_id: q.data.id })
    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError('admin.course_contacts.remove_failed', err, { path: 'admin_review' })
  }
}
