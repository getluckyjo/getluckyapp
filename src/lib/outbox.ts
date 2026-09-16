/**
 * The outbox: work a request should not wait for (docs/stage-4-proposal.md §2).
 *
 *   await enqueue(admin, 'witness_request', { betId })
 *
 * A row per job. /api/cron/outbox drains due rows every minute: claim
 * (conditional update, which is also the lease), run the handler, mark done,
 * or schedule the retry with backoff. After the last attempt the row is a
 * dead letter and ops are alerted. Handlers must be safe to run twice: a
 * runner can die between doing the work and marking it done.
 *
 * Ops alerts do not go through here. An alert about the outbox being stuck
 * must not sit in the outbox.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { log, errorMessage } from '@/lib/observability/log'
import { alertOps } from '@/lib/observability/alerts'
import { sendWitnessRequests } from '@/lib/claims/confirmation'
import { sendWelcomeEmail } from '@/lib/email/welcome'
import { sendFeedbackEmail } from '@/lib/email/feedback'

type Admin = SupabaseClient<Database>

export type JobKind = 'witness_request' | 'welcome_email' | 'feedback_email'

export interface JobPayloads {
  witness_request: { betId: string }
  welcome_email: { email: string; name?: string | null }
  feedback_email: { feedbackId: number }
}

/** Seconds until the next try, by attempt number so far. The last entry is the last try. */
export const BACKOFF_SECONDS = [60, 300, 1_800, 7_200, 43_200] as const
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1
/** How long a claimed job is left alone before another runner may take it. */
export const LEASE_SECONDS = 300

const handlers: { [K in JobKind]: (admin: Admin, payload: JobPayloads[K]) => Promise<void> } = {
  async witness_request(admin, { betId }) {
    const r = await sendWitnessRequests(admin, betId)
    if (r.failed > 0) throw new Error(`${r.failed} request(s) not sent`)
  },
  async welcome_email(_admin, { email, name }) {
    const r = await sendWelcomeEmail({ email, name })
    if (!r.ok) throw new Error(r.error)
  },
  async feedback_email(admin, { feedbackId }) {
    const r = await sendFeedbackEmail(admin, feedbackId)
    if (!r.ok) throw new Error(r.error)
  },
}

export async function enqueue<K extends JobKind>(admin: Admin, kind: K, payload: JobPayloads[K]): Promise<number> {
  // Explicit rather than column defaults, so a job is due the moment it is written.
  const { data, error } = await admin
    .from('outbox')
    .insert({ kind, payload: payload as unknown as Json, attempts: 0, next_attempt_at: new Date().toISOString() })
    .select('id')
    .single()
  if (error) throw error
  log.info('outbox.enqueued', { kind, id: data.id })
  return data.id
}

export interface DrainResult { claimed: number; done: number; retried: number; dead: number }

export async function drainOutbox(admin: Admin, opts: { now?: Date; limit?: number } = {}): Promise<DrainResult> {
  const now = opts.now ?? new Date()
  const limit = opts.limit ?? 25
  const result: DrainResult = { claimed: 0, done: 0, retried: 0, dead: 0 }

  const { data: due, error } = await admin
    .from('outbox')
    .select('id, kind, payload, attempts')
    .is('done_at', null)
    .is('failed_at', null)
    .lte('next_attempt_at', now.toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limit)
  if (error) throw error

  for (const job of due ?? []) {
    // Claim: whoever moves next_attempt_at first owns the job for LEASE_SECONDS.
    const attempt = job.attempts + 1
    const lease = new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString()
    const { data: claimed } = await admin
      .from('outbox')
      .update({ next_attempt_at: lease, attempts: attempt })
      .eq('id', job.id)
      .lte('next_attempt_at', now.toISOString())
      .select('id')
    if (!claimed || claimed.length === 0) continue
    result.claimed++

    try {
      const handler = handlers[job.kind as JobKind]
      if (!handler) throw new Error(`unknown job kind: ${job.kind}`)
      await handler(admin, job.payload as never)
      await admin.from('outbox').update({ done_at: new Date().toISOString(), last_error: null }).eq('id', job.id)
      result.done++
      log.info('outbox.done', { id: job.id, kind: job.kind, attempt })
    } catch (err) {
      const message = errorMessage(err).slice(0, 500)
      if (attempt >= MAX_ATTEMPTS) {
        await admin.from('outbox').update({ failed_at: new Date().toISOString(), last_error: message }).eq('id', job.id)
        result.dead++
        await alertOps({
          event: 'outbox.dead_letter',
          path: 'claim',
          summary: `Job ${job.id} (${job.kind}) failed ${attempt} times and will not be retried: ${message}`,
          details: { id: job.id, kind: job.kind, payload: job.payload },
        })
      } else {
        const delay = BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)]
        await admin.from('outbox').update({ next_attempt_at: new Date(now.getTime() + delay * 1000).toISOString(), last_error: message }).eq('id', job.id)
        result.retried++
        log.warn('outbox.retry', { id: job.id, kind: job.kind, attempt, retry_in_s: delay, error: message })
      }
    }
  }

  if (result.claimed > 0) log.info('outbox.drained', { ...result })
  return result
}
