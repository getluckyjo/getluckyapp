import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, dateLike, parseBody } from '@/lib/api/http'
import { PROMO_CODE_PATTERN, generatePromoCode, normalisePromoCode, toAdminPromo, type PromoCodeRow, type PromoUsage } from '@/lib/promo'
import { log } from '@/lib/observability/log'

/**
 * Promo codes (migration 027). Each code is one extra free swing per
 * golfer, up to its cap and until its date. Admins make them here and
 * watch how they are used; no deploy involved.
 */

const PROMO_SELECT = 'id, code, max_uses, expires_at, note, disabled_at, created_at'

const Create = z.object({
  code: z.string().max(60).transform(normalisePromoCode)
    .pipe(z.string().regex(PROMO_CODE_PATTERN, 'A code is 4 to 40 letters, digits or dashes'))
    .optional(),
  maxUses: z.coerce.number().int().min(1).max(100000),
  expiresAt: dateLike.refine(s => Date.parse(s) > Date.now(), 'The expiry must be in the future'),
  note: z.string().trim().max(200).optional(),
})

/** Every code, newest first, with how it has been used. */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  try {
    const [codes, usage] = await Promise.all([
      auth.adminClient.from('promo_codes').select(PROMO_SELECT).order('created_at', { ascending: false }),
      auth.adminClient.rpc('admin_promo_code_usage'),
    ])
    if (codes.error) throw codes.error
    if (usage.error) throw usage.error

    const byCode = new Map<string, PromoUsage>(
      ((usage.data ?? []) as { promo_code_id: string; uses: unknown; claimed: unknown; converted: unknown }[])
        .map(u => [u.promo_code_id, { uses: Number(u.uses ?? 0), claimed: Number(u.claimed ?? 0), converted: Number(u.converted ?? 0) }]),
    )
    const now = Date.now()
    return NextResponse.json({ data: ((codes.data ?? []) as PromoCodeRow[]).map(row => toAdminPromo(row, byCode.get(row.id), now)) })
  } catch (err) {
    return apiError('admin.promos.list_failed', err, { path: 'admin_review' })
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const body = await parseBody(request, Create)
  if (!body.ok) return body.response

  try {
    const { data, error } = await auth.adminClient
      .from('promo_codes')
      .insert({
        code: body.data.code ?? generatePromoCode(),
        max_uses: body.data.maxUses,
        expires_at: new Date(body.data.expiresAt).toISOString(),
        note: body.data.note || null,
        created_by: auth.user.id,
      })
      .select(PROMO_SELECT)
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'That code already exists.', code: 'DUPLICATE' }, { status: 409 })
      }
      throw error
    }
    const row = data as PromoCodeRow
    log.info('admin.promos.created', { id: row.id, max_uses: row.max_uses, expires_at: row.expires_at, by: auth.user.id })
    return NextResponse.json({ data: toAdminPromo(row, undefined) }, { status: 201 })
  } catch (err) {
    return apiError('admin.promos.create_failed', err, { path: 'admin_review' })
  }
}
