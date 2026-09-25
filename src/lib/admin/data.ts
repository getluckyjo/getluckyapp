/**
 * Shared shapes and lookups for the admin API.
 *
 * bets.user_id references auth.users, not profiles, so PostgREST cannot
 * embed `profiles(name)` from bets (it silently returned null names in three
 * handlers). Every handler that needs names uses the lookups here instead.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminBetRecord, BetTier, VerificationQueueItem } from '@/types/admin'
import type { BetStatus, VerificationStatus } from '@/lib/claims/state-machine'

export interface BetRowLike {
  id: string
  user_id: string
  course_id: string
  hole_id: string
  tier: BetTier
  stake_pence: number
  potential_win_pence: number
  status: BetStatus
  declared_result: 'miss' | 'win' | null
  declared_at: string | null
  video_url: string | null
  payment_intent_id: string | null
  created_at: string
  risk_score?: number | null
  risk_flags?: unknown
  payout_reference?: string | null
}

export interface VerificationRowLike {
  id: string
  bet_id: string
  status: VerificationStatus
  certificate_path: string | null
  affidavit_path: string | null
  created_at: string
  documents_received_at: string | null
  reviewer_notes: string | null
  reviewed_by: string | null
  verified_at: string | null
  payout_initiated_at: string | null
  certificate_sha256?: string | null
  certificate_bytes?: number | null
  affidavit_sha256?: string | null
  affidavit_bytes?: number | null
  review_checklist?: unknown
}

export interface Names {
  users: Map<string, string | null>
  courses: Map<string, string>
  holes: Map<string, number>
}

const unique = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((x): x is string => !!x))]

/** Resolve user names, course names and hole numbers for a set of bets in three queries. */
export async function namesForBets(admin: SupabaseClient, bets: Pick<BetRowLike, 'user_id' | 'course_id' | 'hole_id'>[]): Promise<Names> {
  const userIds = unique(bets.map(b => b.user_id))
  const courseIds = unique(bets.map(b => b.course_id))
  const holeIds = unique(bets.map(b => b.hole_id))

  const [profiles, courses, holes] = await Promise.all([
    userIds.length ? admin.from('profiles').select('id, name').in('id', userIds) : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    courseIds.length ? admin.from('courses').select('id, name').in('id', courseIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    holeIds.length ? admin.from('holes').select('id, hole_number').in('id', holeIds) : Promise.resolve({ data: [] as { id: string; hole_number: number }[] }),
  ])

  return {
    users: new Map((profiles.data ?? []).map((p: { id: string; name: string | null }) => [p.id, p.name])),
    courses: new Map((courses.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name])),
    holes: new Map((holes.data ?? []).map((h: { id: string; hole_number: number }) => [h.id, h.hole_number])),
  }
}

export function toAdminBetRecord(b: BetRowLike, names: Names): AdminBetRecord {
  return {
    id: b.id,
    userId: b.user_id,
    userName: names.users.get(b.user_id) ?? null,
    tier: b.tier,
    stakeCents: b.stake_pence,
    potentialWinCents: b.potential_win_pence,
    status: b.status,
    declaredResult: b.declared_result,
    declaredAt: b.declared_at,
    videoUrl: b.video_url,
    paymentIntentId: b.payment_intent_id,
    courseName: names.courses.get(b.course_id) ?? '',
    courseId: b.course_id,
    holeNumber: names.holes.get(b.hole_id) ?? 0,
    holeId: b.hole_id,
    createdAt: b.created_at,
  }
}

export function toQueueItem(v: VerificationRowLike, bet: BetRowLike | undefined, names: Names): VerificationQueueItem {
  return {
    id: v.id,
    betId: v.bet_id,
    status: v.status,
    tier: bet?.tier ?? 'tier_1',
    stakeCents: bet?.stake_pence ?? 0,
    potentialWinCents: bet?.potential_win_pence ?? 0,
    videoUrl: bet?.video_url ?? null,
    certificatePath: v.certificate_path,
    affidavitPath: v.affidavit_path,
    userName: bet ? names.users.get(bet.user_id) ?? null : null,
    userId: bet?.user_id ?? '',
    courseName: bet ? names.courses.get(bet.course_id) ?? '' : '',
    holeNumber: bet ? names.holes.get(bet.hole_id) ?? 0 : 0,
    createdAt: v.created_at,
    declaredAt: bet?.declared_at ?? null,
    documentsReceivedAt: v.documents_received_at,
    reviewerNotes: v.reviewer_notes,
    reviewedBy: v.reviewed_by,
    verifiedAt: v.verified_at,
    payoutInitiatedAt: v.payout_initiated_at,
    riskScore: bet?.risk_score ?? 0,
    riskFlagCount: Array.isArray(bet?.risk_flags) ? bet.risk_flags.length : 0,
  }
}

/** Bets for a set of verification rows, keyed by bet id. */
export async function betsForVerifications(admin: SupabaseClient, rows: Pick<VerificationRowLike, 'bet_id'>[]): Promise<Map<string, BetRowLike>> {
  const ids = unique(rows.map(r => r.bet_id))
  if (!ids.length) return new Map()
  // BET_SELECT, so the queue's Flags column and risk sorts have risk_score and risk_flags.
  const { data, error } = await admin.from('bets').select(BET_SELECT).in('id', ids)
  if (error) throw error
  return new Map(((data ?? []) as BetRowLike[]).map(b => [b.id, b]))
}

export const BET_SELECT = 'id, user_id, course_id, hole_id, tier, stake_pence, potential_win_pence, status, declared_result, declared_at, video_url, payment_intent_id, created_at, risk_score, risk_flags, payout_reference'

/**
 * A search term safe to embed in a PostgREST `.or()` filter string: the
 * grammar uses `,` `(` `)` as delimiters and `*` as the wildcard. A `.`
 * inside the value is fine (PostgREST splits `column.op.value` on the first
 * two dots only), and must stay, or `jo.smith@gmail.com` finds nobody.
 */
export function orSearchTerm(raw: string): string {
  return raw.replace(/[,()*%\\"']/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 100)
}

export interface AdminTotals {
  total_revenue_cents: number
  total_payout_cents: number
  total_bets: number
  active_bets: number
  pending_claims: number
  total_users: number
}

/** Dashboard totals from the SQL aggregate (migration 010), coerced to numbers. */
export async function adminTotals(admin: SupabaseClient): Promise<AdminTotals> {
  const { data, error } = await admin.rpc('admin_totals')
  if (error) throw error
  const t = (data ?? {}) as Record<string, unknown>
  const n = (k: string) => Number(t[k] ?? 0)
  return {
    total_revenue_cents: n('total_revenue_cents'),
    total_payout_cents: n('total_payout_cents'),
    total_bets: n('total_bets'),
    active_bets: n('active_bets'),
    pending_claims: n('pending_claims'),
    total_users: n('total_users'),
  }
}
