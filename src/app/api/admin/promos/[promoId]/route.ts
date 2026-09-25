import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, dateLike, parseBody, uuid } from '@/lib/api/http'
import { toAdminPromo, type PromoCodeRow } from '@/lib/promo'
import { log } from '@/lib/observability/log'

/**
 * One promo code: change its cap or its date, switch it off or on, or
 * delete it while nobody has used it. A code that has been used stays on
 * record (the bets point at it); switch it off instead.
 *
 * Lowering the cap below the uses already taken is allowed: it closes the
 * code, and nobody who already played loses their swing.
 */

const PROMO_SELECT = 'id, code, max_uses, expires_at, note, disabled_at, created_at'

const Patch = z.object({
  maxUses: z.coerce.number().int().min(1).max(100000).optional(),
  expiresAt: dateLike.optional(),
  disabled: z.boolean().optional(),
  note: z.string().trim().max(200).nullable().optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'Nothing to update' })

type Ctx = { params: Promise<{ promoId: string }> }

const invalidId = () => NextResponse.json({ error: 'Invalid id', code: 'INVALID_INPUT' }, { status: 400 })

async function usesOf(admin: SupabaseClient, id: string): Promise<number> {
  const { count, error } = await admin.from('bets').select('id', { count: 'exact', head: true }).eq('promo_code_id', id)
  if (error) throw error
  return count ?? 0
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { promoId } = await params
  if (!uuid.safeParse(promoId).success) return invalidId()
  const body = await parseBody(request, Patch)
  if (!body.ok) return body.response

  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.data.maxUses !== undefined) patch.max_uses = body.data.maxUses
    if (body.data.expiresAt !== undefined) patch.expires_at = new Date(body.data.expiresAt).toISOString()
    if (body.data.disabled !== undefined) patch.disabled_at = body.data.disabled ? new Date().toISOString() : null
    if (body.data.note !== undefined) patch.note = body.data.note || null

    const { data, error } = await auth.adminClient
      .from('promo_codes')
      .update(patch)
      .eq('id', promoId)
      .select(PROMO_SELECT)
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const uses = await usesOf(auth.adminClient, promoId)
    log.info('admin.promos.updated', { id: promoId, by: auth.user.id, fields: Object.keys(patch) })
    // The claimed and converted counts are the list's job; a refresh brings them.
    return NextResponse.json({ data: toAdminPromo(data as PromoCodeRow, { uses, claimed: 0, converted: 0 }) })
  } catch (err) {
    return apiError('admin.promos.update_failed', err, { path: 'admin_review' })
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const { promoId } = await params
  if (!uuid.safeParse(promoId).success) return invalidId()

  const inUse = () => NextResponse.json(
    { error: 'Golfers have played this code, so it stays on record. Switch it off instead.', code: 'PROMO_CODE_IN_USE' },
    { status: 409 },
  )

  try {
    if (await usesOf(auth.adminClient, promoId) > 0) return inUse()
    const { data, error } = await auth.adminClient.from('promo_codes').delete().eq('id', promoId).select('id')
    if (error) {
      // 23503: someone played it between the count and the delete.
      if (error.code === '23503') return inUse()
      throw error
    }
    if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    log.info('admin.promos.removed', { id: promoId, by: auth.user.id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError('admin.promos.remove_failed', err, { path: 'admin_review' })
  }
}
