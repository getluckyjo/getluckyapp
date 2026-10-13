/**
 * What becomes of a Stitch consent request, in our tables.
 *
 * attachConsent  a granted consent becomes the golfer's saved card: one
 *                payment_cards row, provider 'stitch', token = consent id.
 *                Idempotent: the return leg and the webhook may both call
 *                it. A golfer who already has a different card keeps it
 *                (the start route refuses a second card; this is the
 *                race where one was added in between), and the new
 *                consent is left for the admin to revoke.
 * closeConsent   a consent that ended without a card.
 * detachConsent  a revoked or expired consent takes its card row with it,
 *                when that row is the one it holds.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { log } from '@/lib/observability/log'
import { cardLabel, type ConsentCard } from './cards'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>

export type AttachResult = 'attached' | 'already' | 'other_card' | 'failed'

export async function attachConsent(admin: Admin, input: { consentId: string; userId: string; card: ConsentCard | null; source: 'return' | 'webhook' }): Promise<AttachResult> {
  const now = new Date().toISOString()
  const { data: existing } = await admin.from('payment_cards').select('token, provider').eq('user_id', input.userId).maybeSingle()
  if (existing && !(existing.provider === 'stitch' && existing.token === input.consentId)) {
    log.warn('stitch.consent.other_card', { user_id: input.userId, consent_id: input.consentId, provider: existing.provider, source: input.source })
    await admin.from('stitch_consent_requests').update({ status: 'granted', updated_at: now }).eq('id', input.consentId)
    return 'other_card'
  }
  if (existing) {
    await admin.from('stitch_consent_requests').update({ status: 'granted', updated_at: now }).eq('id', input.consentId).neq('status', 'granted')
    return 'already'
  }
  const { error } = await admin.from('payment_cards').upsert(
    { user_id: input.userId, token: input.consentId, provider: 'stitch', label: cardLabel(input.card), created_at: now, last_used_at: null },
    { onConflict: 'user_id' },
  )
  if (error) {
    log.error('stitch.consent.attach_failed', error, { path: 'payfast_checkout', user_id: input.userId, consent_id: input.consentId })
    return 'failed'
  }
  await admin.from('stitch_consent_requests').update({ status: 'granted', updated_at: now }).eq('id', input.consentId)
  log.info('stitch.consent.attached', { user_id: input.userId, consent_id: input.consentId, source: input.source, network: input.card?.network ?? null })
  return 'attached'
}

export async function closeConsent(admin: Admin, consentId: string, status: 'closed' | 'failed' | 'expired' | 'revoked'): Promise<void> {
  const { error } = await admin.from('stitch_consent_requests').update({ status, updated_at: new Date().toISOString() }).eq('id', consentId).neq('status', 'granted')
  if (error) log.warn('stitch.consent.close_failed', { consent_id: consentId, error: error.message })
}

export async function detachConsent(admin: Admin, consentId: string, status: 'expired' | 'revoked'): Promise<boolean> {
  const now = new Date().toISOString()
  await admin.from('stitch_consent_requests').update({ status, updated_at: now }).eq('id', consentId)
  const { data, error } = await admin.from('payment_cards').delete().eq('provider', 'stitch').eq('token', consentId).select('user_id')
  if (error) { log.warn('stitch.consent.detach_failed', { consent_id: consentId, error: error.message }); return false }
  const removed = (data ?? []).length > 0
  if (removed) log.info('stitch.consent.detached', { consent_id: consentId, status })
  return removed
}
