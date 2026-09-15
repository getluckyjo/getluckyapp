/**
 * Independent confirmation (docs/stage-4-proposal.md §1.2, Batch 11).
 *
 * Every person named on a claim, and every standing contact of the course,
 * gets an email with a one-time link and one question. Their answer is
 * recorded with the time and a hashed IP, shown to the reviewer, and goes
 * into the evidence pack. The claimant never sees who answered what.
 *
 * Tokens are 32 random bytes, sent once, stored only as a SHA-256. A token
 * works until it is used or expires (14 days); "send again" issues a new one.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, WitnessResponse } from '@/types/database'
import { log } from '@/lib/observability/log'
import { resend } from '@/lib/resend'
import { FROM_ADDRESS } from '@/lib/email/from'
import { buildWitnessRequest } from '@/lib/email/witness-request'
import { hashIdentifier } from '@/lib/risk/hash'

export const TOKEN_TTL_DAYS = 14
type Admin = SupabaseClient<Database>

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Copy the course's standing contacts onto the claim, once each by email. */
export async function attachCourseContacts(admin: Admin, betId: string, verificationId: string, courseId: string): Promise<number> {
  const [{ data: contacts }, { data: existing }] = await Promise.all([
    admin.from('course_contacts').select('name, email').eq('course_id', courseId),
    admin.from('claim_witnesses').select('email').eq('bet_id', betId),
  ])
  const have = new Set((existing ?? []).map(w => w.email.toLowerCase()))
  const rows = (contacts ?? [])
    .filter(c => !have.has(c.email.toLowerCase()))
    .map(c => ({ bet_id: betId, verification_id: verificationId, role: 'club_official' as const, name: c.name, email: c.email.toLowerCase(), source: 'course' as const }))
  if (rows.length === 0) return 0
  const { error } = await admin.from('claim_witnesses').insert(rows)
  if (error) throw error
  return rows.length
}

export interface ClaimContext {
  golferName: string
  courseName: string
  holeNumber: number
  playedOn: string
}

/** What the emails and the public page say about the claim. Never more than this. */
export async function claimContext(admin: Admin, betId: string): Promise<ClaimContext | null> {
  const { data: bet } = await admin.from('bets').select('user_id, course_id, hole_id, declared_at, created_at').eq('id', betId).maybeSingle()
  if (!bet) return null
  const [{ data: profile }, { data: course }, { data: hole }] = await Promise.all([
    admin.from('profiles').select('name').eq('id', bet.user_id).maybeSingle(),
    admin.from('courses').select('name').eq('id', bet.course_id).maybeSingle(),
    admin.from('holes').select('hole_number').eq('id', bet.hole_id).maybeSingle(),
  ])
  const when = new Date(bet.declared_at ?? bet.created_at)
  return {
    golferName: profile?.name?.trim() || 'A Get Lucky golfer',
    courseName: course?.name ?? 'the course',
    holeNumber: hole?.hole_number ?? 0,
    playedOn: when.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }),
  }
}

export interface SendResult { sent: number; failed: number }

/**
 * Email every named person who has not been asked yet (or, with `force`,
 * the given ones again). Each send is its own try: one bad address does
 * not stop the rest, and a failure is logged and retried next time.
 */
export async function sendWitnessRequests(admin: Admin, betId: string, opts: { onlyIds?: string[]; force?: boolean } = {}): Promise<SendResult> {
  const ctx = await claimContext(admin, betId)
  if (!ctx) return { sent: 0, failed: 0 }

  let q = admin.from('claim_witnesses').select('id, role, name, email, requested_at, request_count, response').eq('bet_id', betId)
  if (opts.onlyIds?.length) q = q.in('id', opts.onlyIds)
  const { data: rows, error } = await q
  if (error) throw error

  const result: SendResult = { sent: 0, failed: 0 }
  for (const w of rows ?? []) {
    if (w.response) continue                       // already answered
    if (w.requested_at && !opts.force) continue    // already asked
    const token = newToken()
    const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000).toISOString()
    const mail = buildWitnessRequest({ role: w.role, witnessName: w.name, token, ...ctx })
    try {
      // The row is updated before the send so a token is never live without
      // its hash; a failed send leaves requested_at null and is retried.
      const { error: upErr } = await admin.from('claim_witnesses').update({ token_hash: hashToken(token), token_expires_at: expires }).eq('id', w.id)
      if (upErr) throw upErr
      const { error: sendErr } = await resend.emails.send({ from: FROM_ADDRESS, to: w.email, subject: mail.subject, html: mail.html, text: mail.text })
      if (sendErr) throw new Error(sendErr.message)
      const { error: doneErr } = await admin.from('claim_witnesses').update({ requested_at: new Date().toISOString(), request_count: (w.request_count ?? 0) + 1 }).eq('id', w.id)
      if (doneErr) throw doneErr
      result.sent++
      log.info('witness.request_sent', { bet_id: betId, witness_id: w.id, role: w.role, attempt: (w.request_count ?? 0) + 1 })
    } catch (err) {
      result.failed++
      log.error('witness.request_failed', err, { path: 'claim', bet_id: betId, witness_id: w.id })
    }
  }
  return result
}

export type TokenLookup =
  | { ok: true; witness: { id: string; bet_id: string; role: 'witness' | 'club_official'; name: string; response: WitnessResponse | null }; ctx: ClaimContext }
  | { ok: false; reason: 'not_found' | 'expired' | 'answered' }

/** Resolve a token from the public page. Says as little as it can. */
export async function lookupToken(admin: Admin, token: string): Promise<TokenLookup> {
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return { ok: false, reason: 'not_found' }
  const { data: w } = await admin
    .from('claim_witnesses')
    .select('id, bet_id, role, name, response, token_expires_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle()
  if (!w) return { ok: false, reason: 'not_found' }
  if (w.response) return { ok: false, reason: 'answered' }
  if (!w.token_expires_at || Date.parse(w.token_expires_at) < Date.now()) return { ok: false, reason: 'expired' }
  const ctx = await claimContext(admin, w.bet_id)
  if (!ctx) return { ok: false, reason: 'not_found' }
  return { ok: true, witness: { id: w.id, bet_id: w.bet_id, role: w.role, name: w.name, response: w.response }, ctx }
}

export interface Answer { response: WitnessResponse; note?: string; ip: string; userAgent: string | null }

/** Record the answer and burn the token. Conditional on the token still being unused. */
export async function recordAnswer(admin: Admin, token: string, answer: Answer): Promise<TokenLookup> {
  const found = await lookupToken(admin, token)
  if (!found.ok) return found
  const { data, error } = await admin
    .from('claim_witnesses')
    .update({
      response: answer.response,
      response_note: answer.note?.trim() ? answer.note.trim().slice(0, 500) : null,
      responded_at: new Date().toISOString(),
      response_ip_hash: hashIdentifier('ip', answer.ip),
      response_user_agent: answer.userAgent ? answer.userAgent.slice(0, 300) : null,
      token_hash: null,
      token_expires_at: null,
    })
    .eq('id', found.witness.id)
    .is('response', null)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) return { ok: false, reason: 'answered' }
  log.info('witness.answered', { bet_id: found.witness.bet_id, witness_id: found.witness.id, role: found.witness.role, response: answer.response })
  return found
}
