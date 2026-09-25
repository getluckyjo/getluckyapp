import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody, parseQuery } from '@/lib/api/http'
import { generateInviteCode, normaliseCode, normaliseEmail } from '@/lib/beta'
import { log } from '@/lib/observability/log'

/**
 * The closed-beta list. Admins add an email (the tester signs in with it)
 * or an invite code (the tester types it at /beta). No deploy involved.
 */

const Create = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('email'), value: z.string().trim().toLowerCase().pipe(z.email()), note: z.string().trim().max(200).optional() }),
  z.object({ kind: z.literal('code'), value: z.string().trim().min(4).max(40).optional(), note: z.string().trim().max(200).optional() }),
])

const Remove = z.object({ id: z.coerce.number().int().positive() })

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  try {
    const { data, error } = await auth.adminClient
      .from('beta_access')
      .select('id, kind, value, note, added_by, created_at')
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ data: data ?? [], gate: (process.env.BETA_GATE ?? '').trim().toLowerCase() === 'on' })
  } catch (err) {
    return apiError('admin.beta.list_failed', err)
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const body = await parseBody(request, Create)
  if (!body.ok) return body.response

  const value = body.data.kind === 'email'
    ? normaliseEmail(body.data.value)
    : normaliseCode(body.data.value ?? generateInviteCode())

  try {
    const { data, error } = await auth.adminClient
      .from('beta_access')
      .insert({ kind: body.data.kind, value, note: body.data.note ?? null, added_by: auth.user.id })
      .select('id, kind, value, note, added_by, created_at')
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Already on the list.', code: 'DUPLICATE' }, { status: 409 })
      }
      throw error
    }
    log.info('admin.beta.added', { kind: body.data.kind, by: auth.user.id })
    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    return apiError('admin.beta.add_failed', err)
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const q = parseQuery(request.url, Remove)
  if (!q.ok) return q.response
  try {
    const { data, error } = await auth.adminClient.from('beta_access').delete().eq('id', q.data.id).select('id')
    if (error) throw error
    if (!data || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    log.info('admin.beta.removed', { id: q.data.id, by: auth.user.id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError('admin.beta.remove_failed', err)
  }
}
