/**
 * The velocity and anomaly rules (docs/stage-4-proposal.md §1.5).
 *
 * Evaluated when a claim is submitted and again whenever an admin opens it.
 * The result is written to the bet (risk_score, risk_flags), and because
 * every bet change lands in claim_events, the history of what was flagged
 * and when is kept for free.
 *
 * Nothing here blocks. Every rule has an innocent explanation; the flags
 * exist so the reviewer hears it. Thresholds live in ./thresholds.ts.
 *
 * Free swings, promo swings and golf days are read with their own context:
 * a free swing is by design an account's first bet, a golf day's partners
 * all hold accounts, and a golf day's chosen par 3 draws many claims in a
 * week. Those rules fire on paid claims as before and stay quiet, or
 * drop to low, where the pattern is the product working. (The audit of
 * 10 October: every free-swing claim and every golf-day partner tripped a
 * flag, and a reviewer at ten minutes a claim could not keep up.)
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { log } from '@/lib/observability/log'
import { hashIdentifier } from './hash'
import { THRESHOLDS as T, SEVERITY_SCORE } from './thresholds'
import type { RiskFlag } from './labels'

export type { RiskFlag } from './labels'

export interface RiskResult {
  betId: string
  flags: RiskFlag[]
  score: number
}

type Admin = SupabaseClient<Database>
const CLAIM_STATES = ['claimed', 'verified', 'payout_approved', 'paid'] as const
/** Tiers with no stake: the account's first bet is the point, not a signal. */
const NO_STAKE_TIERS = ['tier_free', 'tier_promo', 'tier_golf_day'] as const
const days = (n: number) => n * 86_400_000

interface BetRow {
  id: string; user_id: string; hole_id: string; status: string; created_at: string
  tier: string; golf_day_id: string | null
  video_sha256: string | null; video_uploaded_at: string | null
  capture_ended_at: string | null; capture_lat: number | null; capture_distance_m: number | null
  created_ip_hash: string | null; claim_ip_hash: string | null; claim_ua_hash: string | null
  risk_flags: unknown; risk_score: number
}

export async function evaluateClaimRisk(admin: Admin, betId: string, now: Date = new Date()): Promise<RiskResult | null> {
  const { data: bet, error } = await admin
    .from('bets')
    .select('id, user_id, hole_id, status, created_at, tier, golf_day_id, video_sha256, video_uploaded_at, capture_ended_at, capture_lat, capture_distance_m, created_ip_hash, claim_ip_hash, claim_ua_hash, risk_flags, risk_score')
    .eq('id', betId)
    .maybeSingle()
  if (error) throw error
  if (!bet) return null
  const b = bet as BetRow

  const [profileRes, userBetsRes, verifRes, witnessRes] = await Promise.all([
    admin.from('profiles').select('created_at, email').eq('id', b.user_id).maybeSingle(),
    admin.from('bets').select('id, status, created_at').eq('user_id', b.user_id),
    admin.from('verifications').select('id, bet_id, status, certificate_sha256, affidavit_sha256').eq('bet_id', b.id).maybeSingle(),
    admin.from('claim_witnesses').select('email').eq('bet_id', b.id),
  ])
  const profile = profileRes.data
  const userBets = userBetsRes.data ?? []
  const thisVerification = verifRes.data
  const witnessEmails = [...new Set((witnessRes.data ?? []).map(w => w.email.toLowerCase()))]

  const flags: RiskFlag[] = []
  const push = (rule: RiskFlag['rule'], severity: RiskFlag['severity'], detail: RiskFlag['detail']) => flags.push({ rule, severity, detail })
  const betAt = Date.parse(b.created_at)
  const noStake = (NO_STAKE_TIERS as readonly string[]).includes(b.tier)
  const golfDay = b.tier === 'tier_golf_day' || !!b.golf_day_id

  // repeat_claimant
  const otherClaims = userBets.filter(x => x.id !== b.id && (CLAIM_STATES as readonly string[]).includes(x.status) && Date.parse(x.created_at) >= now.getTime() - days(T.repeatClaimWindowDays))
  const otherClaimIds = userBets.filter(x => x.id !== b.id && x.status === 'claimed').map(x => x.id)
  let rejected = 0
  if (otherClaimIds.length > 0) {
    const { data } = await admin.from('verifications').select('status').in('bet_id', otherClaimIds).eq('status', 'rejected')
    rejected = data?.length ?? 0
  }
  if (otherClaims.length > 0 || rejected > 0) push('repeat_claimant', 'high', { other_claims: otherClaims.length, rejected })

  // first_bet_win. A free, promo or golf-day swing is an account's first bet
  // by design, so there only a brand-new account is worth a word, and a quiet one.
  const accountAgeHours = profile?.created_at ? Math.round((betAt - Date.parse(profile.created_at)) / 3_600_000) : null
  const newAccount = accountAgeHours !== null && accountAgeHours < T.newAccountHours
  if (noStake) {
    if (newAccount) push('first_bet_win', 'low', { first_bet: userBets.length <= 1, account_age_hours: accountAgeHours, no_stake: true })
  } else if (userBets.length <= 1) push('first_bet_win', 'medium', { first_bet: true, account_age_hours: accountAgeHours })
  else if (newAccount) push('first_bet_win', 'medium', { first_bet: false, account_age_hours: accountAgeHours })

  // shared_ip / shared_device
  const ipHashes = [b.claim_ip_hash, b.created_ip_hash].filter((h): h is string => !!h)
  if (ipHashes.length > 0) {
    const since = new Date(now.getTime() - days(T.sharedIpWindowDays)).toISOString()
    const [byClaim, byCreate] = await Promise.all([
      admin.from('bets').select('user_id, claim_ua_hash, claim_ip_hash').in('claim_ip_hash', ipHashes).neq('user_id', b.user_id).gte('created_at', since),
      admin.from('bets').select('user_id, claim_ua_hash, claim_ip_hash').in('created_ip_hash', ipHashes).neq('user_id', b.user_id).gte('created_at', since),
    ])
    const others = [...(byClaim.data ?? []), ...(byCreate.data ?? [])]
    const accounts = new Set(others.map(o => o.user_id))
    if (accounts.size > 0) push('shared_ip', 'high', { accounts: accounts.size, window_days: T.sharedIpWindowDays })
    if (b.claim_ua_hash && b.claim_ip_hash) {
      const sameDevice = new Set(others.filter(o => o.claim_ua_hash === b.claim_ua_hash && o.claim_ip_hash === b.claim_ip_hash).map(o => o.user_id))
      if (sameDevice.size > 0) push('shared_device', 'high', { accounts: sameDevice.size })
    }
  }

  // upload_lag
  if (b.video_uploaded_at) {
    const sealedAt = Date.parse(b.video_uploaded_at)
    const afterRecording = b.capture_ended_at ? Math.round((sealedAt - Date.parse(b.capture_ended_at)) / 1000) : null
    const afterBetHours = Math.round((sealedAt - betAt) / 3_600_000)
    if (afterRecording !== null && afterRecording > T.uploadLagMaxSeconds) push('upload_lag', 'medium', { after_recording_s: afterRecording, after_bet_hours: afterBetHours })
    else if (afterBetHours > T.uploadAfterBetMaxHours) push('upload_lag', 'medium', { after_recording_s: null, after_bet_hours: afterBetHours })
  }

  // no_location / far_from_course
  if (b.capture_lat === null) push('no_location', 'low', {})
  else if (b.capture_distance_m !== null && b.capture_distance_m > T.farFromCourseMetres) push('far_from_course', 'high', { distance_m: Math.round(b.capture_distance_m) })

  // duplicate_media
  if (b.video_sha256) {
    const { data } = await admin.from('bets').select('id').eq('video_sha256', b.video_sha256).neq('id', b.id)
    if (data && data.length > 0) push('duplicate_media', 'high', { footage: true, matches: data.length })
  }
  const docHashes = [thisVerification?.certificate_sha256, thisVerification?.affidavit_sha256].filter((h): h is string => !!h)
  if (docHashes.length > 0 && thisVerification) {
    const [c, a] = await Promise.all([
      admin.from('verifications').select('id').in('certificate_sha256', docHashes).neq('id', thisVerification.id),
      admin.from('verifications').select('id').in('affidavit_sha256', docHashes).neq('id', thisVerification.id),
    ])
    const matches = new Set([...(c.data ?? []), ...(a.data ?? [])].map(v => v.id))
    if (matches.size > 0) push('duplicate_media', 'high', { footage: false, matches: matches.size })
  }

  // witness_overlap. On a golf day every partner is a player with an
  // account, and the same four-ball witnesses each other's swings: only a
  // witness named on a claim outside this golf day counts there.
  if (witnessEmails.length > 0) {
    const [holders, elsewhere] = await Promise.all([
      golfDay ? Promise.resolve({ data: [] as { id: string }[] }) : admin.from('profiles').select('id').in('email', witnessEmails),
      admin.from('claim_witnesses').select('bet_id').in('email', witnessEmails).neq('bet_id', b.id),
    ])
    const accountHolders = holders.data?.length ?? 0
    let otherBetIds = [...new Set((elsewhere.data ?? []).map(w => w.bet_id))]
    if (golfDay && otherBetIds.length > 0) {
      const { data: sameDay } = await admin.from('bets').select('id').in('id', otherBetIds).eq('golf_day_id', b.golf_day_id as string)
      const same = new Set((sameDay ?? []).map(x => x.id))
      otherBetIds = otherBetIds.filter(id => !same.has(id))
    }
    const otherClaimCount = otherBetIds.length
    if (accountHolders > 0 || otherClaimCount > 0) push('witness_overlap', 'high', { account_holders: accountHolders, other_claims: otherClaimCount })
  }

  // hole_cluster. A golf day's par 3 is meant to draw claims, so golf-day
  // swings neither trip the rule nor count towards it.
  if (!golfDay) {
    const since = new Date(now.getTime() - days(T.holeClusterWindowDays)).toISOString()
    const { data } = await admin.from('bets').select('id').eq('hole_id', b.hole_id).in('status', [...CLAIM_STATES]).is('golf_day_id', null).gte('created_at', since)
    const claims = data?.length ?? 0
    if (claims >= T.holeClusterCount) push('hole_cluster', 'medium', { claims, window_days: T.holeClusterWindowDays })
  }

  // deleted_and_back
  const emailHash = hashIdentifier('email', profile?.email)
  if (emailHash) {
    const { data } = await admin.from('deleted_accounts').select('bets').eq('email_hash', emailHash)
    const previousBets = (data ?? []).reduce((s, r) => s + Number(r.bets ?? 0), 0)
    if (data && data.length > 0) push('deleted_and_back', 'high', { previous_bets: previousBets })
  }

  const score = flags.reduce((s, f) => s + SEVERITY_SCORE[f.severity], 0)
  return { betId: b.id, flags, score }
}

/** Evaluate and write to the bet. Flags are only rewritten when they changed, so claim_events stays quiet. */
export async function refreshClaimRisk(admin: Admin, betId: string, now: Date = new Date()): Promise<RiskResult | null> {
  const result = await evaluateClaimRisk(admin, betId, now)
  if (!result) return null
  const { data: current } = await admin.from('bets').select('risk_flags, risk_score').eq('id', betId).maybeSingle()
  const changed = JSON.stringify(current?.risk_flags ?? null) !== JSON.stringify(result.flags) || (current?.risk_score ?? 0) !== result.score
  const { error } = await admin
    .from('bets')
    .update(changed
      ? { risk_flags: result.flags as unknown as Database['public']['Tables']['bets']['Update']['risk_flags'], risk_score: result.score, risk_evaluated_at: now.toISOString() }
      : { risk_evaluated_at: now.toISOString() })
    .eq('id', betId)
  if (error) throw error
  if (changed) log.info('risk.flags_changed', { bet_id: betId, score: result.score, rules: result.flags.map(f => f.rule) })
  return result
}

/** Best-effort wrapper for request paths: a failed evaluation is logged, never surfaced. */
export async function tryRefreshClaimRisk(admin: Admin, betId: string): Promise<RiskResult | null> {
  try {
    return await refreshClaimRisk(admin, betId)
  } catch (err) {
    log.error('risk.evaluate_failed', err, { path: 'claim', bet_id: betId })
    return null
  }
}
