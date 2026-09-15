import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError, parseBody } from '@/lib/api/http'
import { BET_SELECT, betsForVerifications, namesForBets, type BetRowLike, type VerificationRowLike } from '@/lib/admin/data'
import { log } from '@/lib/observability/log'
import { toCSV } from '@/lib/admin/csv'

const Body = z.object({ type: z.enum(['bets', 'users', 'verifications']) })

const LIMIT = 500

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response
  const { type } = body.data
  const admin = auth.adminClient

  try {
    let csv = ''

    if (type === 'bets') {
      const { data, error } = await admin.from('bets').select(BET_SELECT).order('created_at', { ascending: false }).limit(LIMIT)
      if (error) throw error
      const bets = (data ?? []) as BetRowLike[]
      const names = await namesForBets(admin, bets)
      csv = toCSV(
        ['ID', 'User', 'Course', 'Hole', 'Tier', 'Stake (cents)', 'Potential Win (cents)', 'Status', 'Declared Result', 'Created'],
        bets.map(b => [b.id, names.users.get(b.user_id) ?? '', names.courses.get(b.course_id) ?? '', String(names.holes.get(b.hole_id) ?? ''), b.tier, String(b.stake_pence), String(b.potential_win_pence), b.status, b.declared_result ?? '', b.created_at]),
      )
    } else if (type === 'users') {
      const { data, error } = await admin.from('profiles').select('id, name, email, handicap, total_attempts, payment_method, is_admin, suspended_at, created_at').order('created_at', { ascending: false }).limit(LIMIT)
      if (error) throw error
      type P = { id: string; name: string | null; email: string | null; handicap: number | null; total_attempts: number | null; payment_method: string | null; is_admin: boolean | null; suspended_at: string | null; created_at: string }
      csv = toCSV(
        ['ID', 'Name', 'Email', 'Handicap', 'Total Attempts', 'Payment Method', 'Admin', 'Suspended', 'Created'],
        ((data ?? []) as P[]).map(p => [p.id, p.name ?? '', p.email ?? '', String(p.handicap ?? ''), String(p.total_attempts ?? 0), p.payment_method ?? '', p.is_admin ? 'Yes' : 'No', p.suspended_at ? 'Yes' : 'No', p.created_at]),
      )
    } else {
      const { data, error } = await admin.from('verifications').select('*').order('created_at', { ascending: false }).limit(LIMIT)
      if (error) throw error
      const rows = (data ?? []) as VerificationRowLike[]
      const bets = await betsForVerifications(admin, rows)
      const names = await namesForBets(admin, [...bets.values()])
      csv = toCSV(
        ['ID', 'Bet ID', 'User', 'Course', 'Hole', 'Tier', 'Potential Win (cents)', 'Status', 'Submitted', 'Docs Received', 'Verified'],
        rows.map(v => {
          const b = bets.get(v.bet_id)
          return [v.id, v.bet_id, b ? names.users.get(b.user_id) ?? '' : '', b ? names.courses.get(b.course_id) ?? '' : '', b ? String(names.holes.get(b.hole_id) ?? '') : '', b?.tier ?? '', String(b?.potential_win_pence ?? ''), v.status, v.created_at, v.documents_received_at ?? '', v.verified_at ?? '']
        }),
      )
    }

    log.info('admin.export', { admin_id: auth.user.id, type })
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${type}-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (err) {
    return apiError('admin.export_failed', err, { path: 'admin_review' })
  }
}
