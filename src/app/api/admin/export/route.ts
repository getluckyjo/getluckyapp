import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { MOCK_ADMIN_BETS, MOCK_ADMIN_USERS, MOCK_ADMIN_VERIFICATIONS } from '@/lib/admin-mock-data'

function toCSV(headers: string[], rows: string[][]): string {
  const escape = (v: string) => {
    let safe = v.replace(/"/g, '""')
    // Prevent CSV injection: prefix formula-triggering characters with a single quote
    if (/^[=+\-@\t\r]/.test(safe)) safe = `'${safe}`
    return `"${safe}"`
  }
  const lines = [headers.map(escape).join(',')]
  rows.forEach(row => lines.push(row.map(v => escape(String(v ?? ''))).join(',')))
  return lines.join('\n')
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const body = await request.json()
    const { type } = body as { type: 'bets' | 'users' | 'verifications' }

    let csv = ''

    if (type === 'bets') {
      if (auth.isMock || !auth.adminClient) {
        csv = toCSV(
          ['ID', 'User', 'Course', 'Hole', 'Tier', 'Stake (cents)', 'Potential Win (cents)', 'Status', 'Declared Result', 'Created'],
          MOCK_ADMIN_BETS.map(b => [b.id, b.userName ?? '', b.courseName, String(b.holeNumber), b.tier, String(b.stakeCents), String(b.potentialWinCents), b.status, b.declaredResult ?? '', b.createdAt])
        )
      } else {
        const { data } = await auth.adminClient
          .from('bets')
          .select(`*, profiles ( name ), courses ( name ), holes ( hole_number )`)
          .order('created_at', { ascending: false })
          .limit(500)

        csv = toCSV(
          ['ID', 'User', 'Course', 'Hole', 'Tier', 'Stake (cents)', 'Potential Win (cents)', 'Status', 'Declared Result', 'Created'],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (data ?? []).map((b: any) => [b.id, b.profiles?.name ?? '', b.courses?.name ?? '', String(b.holes?.hole_number ?? ''), b.tier, String(b.stake_pence), String(b.potential_win_pence), b.status, b.declared_result ?? '', b.created_at])
        )
      }
    } else if (type === 'users') {
      if (auth.isMock || !auth.adminClient) {
        csv = toCSV(
          ['ID', 'Name', 'Email', 'Handicap', 'Total Attempts', 'Total Staked (cents)', 'Total Won (cents)', 'Payment Method', 'Suspended', 'Created'],
          MOCK_ADMIN_USERS.map(u => [u.id, u.name ?? '', u.email, String(u.handicap ?? ''), String(u.totalAttempts), String(u.totalStaked), String(u.totalWon), u.paymentMethod ?? '', u.suspendedAt ? 'Yes' : 'No', u.createdAt])
        )
      } else {
        const { data } = await auth.adminClient.from('profiles').select('*').order('created_at', { ascending: false }).limit(500)
        csv = toCSV(
          ['ID', 'Name', 'Handicap', 'Total Attempts', 'Payment Method', 'Admin', 'Suspended', 'Created'],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (data ?? []).map((p: any) => [p.id, p.name ?? '', String(p.handicap ?? ''), String(p.total_attempts ?? 0), p.payment_method ?? '', p.is_admin ? 'Yes' : 'No', p.suspended_at ? 'Yes' : 'No', p.created_at])
        )
      }
    } else if (type === 'verifications') {
      if (auth.isMock || !auth.adminClient) {
        csv = toCSV(
          ['ID', 'Bet ID', 'User', 'Course', 'Hole', 'Tier', 'Potential Win (cents)', 'Status', 'Submitted', 'Docs Received', 'Verified'],
          MOCK_ADMIN_VERIFICATIONS.map(v => [v.id, v.betId, v.userName ?? '', v.courseName, String(v.holeNumber), v.tier, String(v.potentialWinCents), v.status, v.createdAt, v.documentsReceivedAt ?? '', v.verifiedAt ?? ''])
        )
      } else {
        const { data } = await auth.adminClient
          .from('verifications')
          .select(`*, bets!inner ( tier, potential_win_pence, user_id, courses ( name ), holes ( hole_number ), profiles ( name ) )`)
          .order('created_at', { ascending: false })
          .limit(500)

        csv = toCSV(
          ['ID', 'Bet ID', 'User', 'Course', 'Hole', 'Tier', 'Potential Win (cents)', 'Status', 'Submitted', 'Docs Received', 'Verified'],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (data ?? []).map((v: any) => [v.id, v.bet_id, v.bets?.profiles?.name ?? '', v.bets?.courses?.name ?? '', String(v.bets?.holes?.hole_number ?? ''), v.bets?.tier ?? '', String(v.bets?.potential_win_pence ?? ''), v.status, v.created_at, v.documents_received_at ?? '', v.verified_at ?? ''])
        )
      }
    } else {
      return NextResponse.json({ error: 'Invalid export type' }, { status: 400 })
    }

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${type}-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
