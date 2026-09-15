import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, parseQuery, pagination, boolString, searchTerm } from '@/lib/api/http'
import { log } from '@/lib/observability/log'
import { CourseFields } from '@/lib/admin/schemas'
import type { AdminCourseRecord, PaginatedResponse } from '@/types/admin'

const Query = pagination.extend({
  search: searchTerm.optional(),
  partner: boolString.optional(),
})

interface CourseRowLike { id: string; name: string; region: string | null; [k: string]: unknown }

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const q = parseQuery(request.url, Query)
  if (!q.ok) return q.response
  const { search, partner, page, limit } = q.data

  try {
    let query = auth.adminClient.from('courses').select('*', { count: 'exact' })
    if (partner !== undefined) query = query.eq('is_partner', partner)
    query = query.order('name', { ascending: true })
    const offset = (page - 1) * limit
    query = query.range(offset, offset + limit - 1)

    const { data, count, error } = await query
    if (error) throw error
    const courses = (data ?? []) as CourseRowLike[]

    const ids = courses.map(c => c.id)
    const { data: holes } = ids.length
      ? await auth.adminClient.from('holes').select('id, course_id, is_active').in('course_id', ids)
      : { data: [] as { id: string; course_id: string; is_active: boolean }[] }
    const holeStats = new Map<string, { total: number; active: number }>()
    for (const h of (holes ?? []) as { course_id: string; is_active: boolean }[]) {
      const s = holeStats.get(h.course_id) ?? { total: 0, active: 0 }
      s.total += 1
      if (h.is_active) s.active += 1
      holeStats.set(h.course_id, s)
    }

    let records = courses.map(c => ({
      ...c,
      holeCount: holeStats.get(c.id)?.total ?? 0,
      activeHoleCount: holeStats.get(c.id)?.active ?? 0,
      totalBets: 0,
    })) as unknown as AdminCourseRecord[]

    if (search) {
      const s = search.toLowerCase()
      records = records.filter(c => c.name.toLowerCase().includes(s) || (c.region?.toLowerCase() ?? '').includes(s))
    }

    const total = count ?? records.length
    const resp: PaginatedResponse<AdminCourseRecord> = { data: records, total, page, limit, totalPages: Math.ceil(total / limit) }
    return NextResponse.json(resp)
  } catch (err) {
    return apiError('admin.courses.list_failed', err, { path: 'admin_review' })
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const body = await parseBody(request, CourseFields)
  if (!body.ok) return body.response

  try {
    const { data, error } = await auth.adminClient
      .from('courses')
      .insert({
        name: body.data.name,
        location_text: body.data.location_text ?? null,
        region: body.data.region ?? null,
        country: body.data.country,
        lat: body.data.lat ?? null,
        lng: body.data.lng ?? null,
        image_url: body.data.image_url ?? null,
        is_partner: body.data.is_partner,
      })
      .select('id')
      .single()
    if (error) throw error
    log.info('admin.course_created', { admin_id: auth.user.id, course_id: data.id, name: body.data.name })
    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    return apiError('admin.courses.create_failed', err, { path: 'admin_review' })
  }
}
