import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, invalidInput, parseBody, parseQuery, pagination, boolString, searchTerm } from '@/lib/api/http'
import { orSearchTerm } from '@/lib/admin/data'
import { log } from '@/lib/observability/log'
import { CourseFields } from '@/lib/admin/schemas'
import type { AdminCourseRecord, PaginatedResponse } from '@/types/admin'

const Query = pagination.extend({
  search: searchTerm.optional(),
  partner: boolString.optional(),
})

interface CourseRowLike { id: string; name: string; [k: string]: unknown }

/** A course in the list, with its optional club contacts counted. */
type CourseListRecord = AdminCourseRecord & { officialCount: number }

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const q = parseQuery(request.url, Query)
  if (!q.ok) return q.response
  const { search, partner, page, limit } = q.data
  const admin = auth.adminClient

  try {
    let query = admin.from('courses').select('*', { count: 'exact' })
    if (partner !== undefined) query = query.eq('is_partner', partner)
    if (search) {
      // In the query, before the page is cut, so the count and the pages are right.
      const s = orSearchTerm(search)
      query = query.or(`name.ilike.*${s}*,region.ilike.*${s}*,location_text.ilike.*${s}*`)
    }
    const offset = (page - 1) * limit
    const { data, count, error } = await query.order('name', { ascending: true }).range(offset, offset + limit - 1)
    if (error) throw error
    const courses = (data ?? []) as CourseRowLike[]
    if (!courses.length) return NextResponse.json({ data: [], total: count ?? 0, page, limit, totalPages: Math.ceil((count ?? 0) / limit) } satisfies PaginatedResponse<CourseListRecord>)

    // The page's holes, officials and bets at once. Bets are a head count per
    // course: reading their rows would stop at PostgREST's 1,000-row cap.
    const ids = courses.map(c => c.id)
    const [holesRes, contactsRes, betCounts] = await Promise.all([
      admin.from('holes').select('course_id, is_active').in('course_id', ids),
      admin.from('course_contacts').select('course_id').in('course_id', ids),
      Promise.all(ids.map(id => admin.from('bets').select('id', { count: 'exact', head: true }).eq('course_id', id))),
    ])
    if (holesRes.error) throw holesRes.error
    if (contactsRes.error) throw contactsRes.error
    for (const r of betCounts) if (r.error) throw r.error

    const holeStats = new Map<string, { total: number; active: number }>()
    for (const h of (holesRes.data ?? []) as { course_id: string; is_active: boolean }[]) {
      const s = holeStats.get(h.course_id) ?? { total: 0, active: 0 }
      s.total += 1
      if (h.is_active) s.active += 1
      holeStats.set(h.course_id, s)
    }
    const officialCounts = new Map<string, number>()
    for (const c of (contactsRes.data ?? []) as { course_id: string }[]) officialCounts.set(c.course_id, (officialCounts.get(c.course_id) ?? 0) + 1)

    const records = courses.map((c, i) => ({
      ...c,
      holeCount: holeStats.get(c.id)?.total ?? 0,
      activeHoleCount: holeStats.get(c.id)?.active ?? 0,
      officialCount: officialCounts.get(c.id) ?? 0,
      totalBets: betCounts[i].count ?? 0,
    })) as unknown as CourseListRecord[]

    const total = count ?? records.length
    const resp: PaginatedResponse<CourseListRecord> = { data: records, total, page, limit, totalPages: Math.ceil(total / limit) }
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
  // A latitude without a longitude places nothing.
  if ((body.data.lat == null) !== (body.data.lng == null)) return invalidInput([{ path: 'lng', message: 'Give both latitude and longitude, or neither' }])

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
