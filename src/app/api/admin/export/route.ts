import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody } from '@/lib/api/http'
import { BET_SELECT, betsForVerifications, namesForBets, type BetRowLike, type VerificationRowLike } from '@/lib/admin/data'
import { PAYMENT_SELECT, betsByReference, namesForPayments, toPaymentRecord, type PaymentRowLike } from '@/lib/admin/payments'
import { log } from '@/lib/observability/log'
import { toCSV } from '@/lib/admin/csv'
import { betFilters, betSearchConditions } from '../bets/filters'
import { paymentFilters, paymentSearchConditions, paymentsSource } from '../payments/filters'

/**
 * What to export. `bets` and `payments` take their list's filters, under the
 * same names as the list's query string, so the file holds what the page
 * shows. A caller that sends only `type` gets everything, as before.
 */
const Body = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bets'), ...betFilters }),
  z.object({ type: z.literal('payments'), ...paymentFilters, unmatched: z.boolean().optional() }),
  z.object({ type: z.literal('users') }),
  z.object({ type: z.literal('verifications') }),
])

/** Rows per file. A longer export is cut here and says so in X-Export-Capped, rather than stopping quietly. */
const CAP = 10_000
/** Rows per request: PostgREST's default max-rows. */
const PAGE = 1000
/** Rows per name lookup, so each `in.(…)` list of ids stays well inside a URL. */
const SLICE = 200

const SAST_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Johannesburg',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

/** "2026-09-17 10:00:00" in South African time: the time the admins read, and it sorts as text. */
function sast(at: string | Date | null | undefined): string {
  if (!at) return ''
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return String(at)
  const p = Object.fromEntries(SAST_PARTS.formatToParts(d).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
}

interface Sheet { headers: string[]; rows: string[][]; capped: boolean }

/**
 * Every row a query gives, a page at a time, up to the cap. One row past the
 * cap is asked for, to know whether there were more.
 */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = []
  while (rows.length <= CAP) {
    const from = rows.length
    const to = Math.min(from + PAGE, CAP + 1) - 1
    const { data, error } = await page(from, to)
    if (error) throw error
    const got = (data ?? []) as T[]
    rows.push(...got)
    if (got.length < to - from + 1) break
  }
  return { rows: rows.slice(0, CAP), capped: rows.length > CAP }
}

/** Run a lookup by ids SLICE rows at a time. */
async function inSlices<T, R>(rows: T[], lookup: (slice: T[]) => Promise<R>): Promise<R[]> {
  const parts: R[] = []
  for (let i = 0; i < rows.length; i += SLICE) parts.push(await lookup(rows.slice(i, i + SLICE)))
  return parts
}

const joined = <K, V>(maps: Map<K, V>[]): Map<K, V> => new Map(maps.flatMap(m => [...m]))

/** The name maps from each slice, as one set. */
function joinNames<U>(parts: { users: Map<string, U>; courses: Map<string, string>; holes: Map<string, number> }[]) {
  return {
    users: joined(parts.map(p => p.users)),
    courses: joined(parts.map(p => p.courses)),
    holes: joined(parts.map(p => p.holes)),
  }
}

type BetsBody = Extract<z.infer<typeof Body>, { type: 'bets' }>
type PaymentsBody = Extract<z.infer<typeof Body>, { type: 'payments' }>

// Each export reads rows made up to `before`, the moment it started, so a
// bet placed meanwhile cannot shift a page and repeat a row.

async function betsSheet(admin: SupabaseClient, f: BetsBody, before: string): Promise<Sheet> {
  const headers = ['ID', 'User', 'Course', 'Hole', 'Tier', 'Stake (cents)', 'Potential Win (cents)', 'Status', 'Declared Result', 'Created (SAST)']
  const conds = f.search ? await betSearchConditions(admin, f.search) : null
  if (conds && !conds.length) return { headers, rows: [], capped: false }

  const { rows: bets, capped } = await readAll<BetRowLike>((from, to) => {
    let q = admin.from('bets').select(BET_SELECT).lte('created_at', before)
    if (f.status) q = q.eq('status', f.status)
    if (f.tier) q = q.eq('tier', f.tier)
    if (conds) q = q.or(conds.join(','))
    return q.order('created_at', { ascending: false }).order('id').range(from, to)
  })
  const names = joinNames(await inSlices(bets, s => namesForBets(admin, s)))
  return {
    headers,
    capped,
    rows: bets.map(b => [b.id, names.users.get(b.user_id) ?? '', names.courses.get(b.course_id) ?? '', String(names.holes.get(b.hole_id) ?? ''), b.tier, String(b.stake_pence), String(b.potential_win_pence), b.status, b.declared_result ?? '', sast(b.created_at)]),
  }
}

async function paymentsSheet(admin: SupabaseClient, f: PaymentsBody, before: string): Promise<Sheet> {
  const conds = f.search ? await paymentSearchConditions(admin, f.search) : null
  const { rows: payments, capped } = await readAll<PaymentRowLike>((from, to) => {
    let q = admin.from(paymentsSource(f.unmatched)).select(PAYMENT_SELECT).lte('created_at', before)
    if (f.status) q = q.eq('status', f.status)
    if (conds) q = q.or(conds.join(','))
    return q.order('created_at', { ascending: false }).order('m_payment_id').range(from, to)
  })
  const parts = await inSlices(payments, s => Promise.all([namesForPayments(admin, s), betsByReference(admin, s)]))
  const names = joinNames(parts.map(([n]) => n))
  const byReference = joined(parts.map(([, b]) => b))
  return {
    headers: ['Reference', 'PayFast Reference', 'Golfer', 'Email', 'Course', 'Hole', 'Tier', 'Amount (cents)', 'Status', 'Paid With', 'Bet ID', 'Created (SAST)'],
    capped,
    rows: payments.map(r => {
      const p = toPaymentRecord(r, names)
      // The ledger's bet_id link is best-effort; the bet's own reference is the fallback, as on the page.
      const betId = p.betId ?? byReference.get(r.m_payment_id) ?? ''
      return [p.mPaymentId, p.pfPaymentId ?? '', p.userName ?? '', p.userEmail ?? '', p.courseName ?? '', String(p.holeNumber ?? ''), p.tier ?? '', String(p.amountCents), p.status, p.source === 'saved_card' ? 'Saved card' : 'Checkout', betId, sast(p.createdAt)]
    }),
  }
}

async function usersSheet(admin: SupabaseClient, before: string): Promise<Sheet> {
  type P = { id: string; name: string | null; email: string | null; handicap: number | null; total_attempts: number | null; payment_method: string | null; is_admin: boolean | null; suspended_at: string | null; created_at: string }
  const { rows, capped } = await readAll<P>((from, to) =>
    admin.from('profiles').select('id, name, email, handicap, total_attempts, payment_method, is_admin, suspended_at, created_at')
      .lte('created_at', before).order('created_at', { ascending: false }).order('id').range(from, to))
  return {
    headers: ['ID', 'Name', 'Email', 'Handicap', 'Total Attempts', 'Payment Method', 'Admin', 'Suspended', 'Created (SAST)'],
    capped,
    rows: rows.map(p => [p.id, p.name ?? '', p.email ?? '', String(p.handicap ?? ''), String(p.total_attempts ?? 0), p.payment_method ?? '', p.is_admin ? 'Yes' : 'No', p.suspended_at ? 'Yes' : 'No', sast(p.created_at)]),
  }
}

async function verificationsSheet(admin: SupabaseClient, before: string): Promise<Sheet> {
  const { rows, capped } = await readAll<VerificationRowLike>((from, to) =>
    admin.from('verifications').select('*').lte('created_at', before).order('created_at', { ascending: false }).order('id').range(from, to))
  const bets = joined(await inSlices(rows, s => betsForVerifications(admin, s)))
  const names = joinNames(await inSlices([...bets.values()], s => namesForBets(admin, s)))
  return {
    headers: ['ID', 'Bet ID', 'User', 'Course', 'Hole', 'Tier', 'Potential Win (cents)', 'Status', 'Submitted (SAST)', 'Docs Received (SAST)', 'Verified (SAST)'],
    capped,
    rows: rows.map(v => {
      const b = bets.get(v.bet_id)
      return [v.id, v.bet_id, b ? names.users.get(b.user_id) ?? '' : '', b ? names.courses.get(b.course_id) ?? '' : '', b ? String(names.holes.get(b.hole_id) ?? '') : '', b?.tier ?? '', String(b?.potential_win_pence ?? ''), v.status, sast(v.created_at), sast(v.documents_received_at), sast(v.verified_at)]
    }),
  }
}

/**
 * POST /api/admin/export — a CSV of bets, payments, users or claims.
 *
 * Up to CAP rows, newest first, times in South African time, and the file
 * named by the South African date. X-Export-Rows says how many rows the file
 * holds; X-Export-Capped (the cap) is there only when there were more. A
 * failure is JSON with an error status, never a file.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response
  const f = body.data
  const admin = auth.adminClient
  const started = new Date()
  const before = started.toISOString()

  try {
    const sheet =
      f.type === 'bets' ? await betsSheet(admin, f, before)
      : f.type === 'payments' ? await paymentsSheet(admin, f, before)
      : f.type === 'users' ? await usersSheet(admin, before)
      : await verificationsSheet(admin, before)

    log.info('admin.export', { admin_id: auth.user.id, type: f.type, rows: sheet.rows.length, capped: sheet.capped })
    const headers: Record<string, string> = {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${f.type}-export-${sast(started).slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
      'X-Export-Rows': String(sheet.rows.length),
    }
    if (sheet.capped) headers['X-Export-Capped'] = String(CAP)
    return new NextResponse(toCSV(sheet.headers, sheet.rows), { headers })
  } catch (err) {
    return apiError('admin.export_failed', err, { path: 'admin_review' })
  }
}
