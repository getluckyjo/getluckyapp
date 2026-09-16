/**
 * The ops email for one piece of beta feedback. Plain text on purpose: it
 * is read by one person, quoted into issues, and must survive any client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resend } from '@/lib/resend'
import { FROM_ADDRESS } from '@/lib/email/from'

const OPS_EMAIL = (process.env.OPS_ALERT_EMAIL ?? 'johannes@getluckygolfclub.com').trim()

export type SendResult = { ok: true; id: string | null } | { ok: false; error: string }

export async function sendFeedbackEmail(admin: SupabaseClient<Database>, feedbackId: number): Promise<SendResult> {
  const { data: row, error } = await admin.from('feedback').select('*').eq('id', feedbackId).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!row) return { ok: true, id: null } // deleted since; nothing to send

  let who = 'signed out'
  if (row.user_id) {
    const { data: profile } = await admin.from('profiles').select('name, email').eq('id', row.user_id).maybeSingle()
    who = profile ? `${profile.name ?? 'no name'} <${profile.email ?? row.user_id}>` : row.user_id
  }

  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown'
  const lines = [
    `From: ${who}`,
    `Route: ${row.route ?? '-'}`,
    `Mode: ${row.standalone === null ? '-' : row.standalone ? 'installed app' : 'browser'}`,
    `Build: ${row.app_version ?? '-'}${row.build_date ? ` (${row.build_date})` : ''}`,
    `Screen: ${row.screen ?? '-'}`,
    `Device: ${row.user_agent ?? '-'}`,
    `Sent: ${row.created_at}`,
    '',
    row.message,
  ]

  const { data, error: sendError } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: OPS_EMAIL,
    subject: `[Get Lucky ${env}] Beta feedback #${row.id}: ${row.message.slice(0, 60).replace(/\s+/g, ' ')}`,
    text: lines.join('\n'),
  })
  if (sendError) return { ok: false, error: sendError.message }
  return { ok: true, id: data?.id ?? null }
}
