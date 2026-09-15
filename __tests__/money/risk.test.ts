/**
 * Risk signals and review discipline (Stage 4, Batch 10).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'
import { hashIdentifier, _resetSaltWarning } from '@/lib/risk/hash'
import { evaluateClaimRisk, refreshClaimRisk } from '@/lib/risk/rules'
import { THRESHOLDS } from '@/lib/risk/thresholds'
import { describeFlag, RULE_LABELS, type RiskFlag } from '@/lib/risk/labels'
import { REVIEW_CHECKLIST } from '@/lib/claims/checklist'
import { POST as submitClaim } from '@/app/api/verifications/[betId]/route'
import { GET as adminDetail, PATCH as adminReview } from '@/app/api/admin/verifications/[verificationId]/route'
import { GET as queue } from '@/app/api/admin/verifications/route'
import { POST as batchReview } from '@/app/api/admin/verifications/batch/route'
import { PATCH as adminBet } from '@/app/api/admin/bets/[betId]/route'
import { DELETE as deleteAccount } from '@/app/api/account/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
const adminAuth = vi.hoisted(() => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)
vi.mock('@/lib/admin-auth', () => adminAuth)

const SALT = 'a-salt-long-enough-for-tests'
const USER_C = { id: '55555555-5555-4555-8555-555555555555', email: 'c@example.com' }
const HOLE_2 = '66666666-6666-4666-8666-666666666666'
const NOW = new Date('2026-09-15T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const H = 3_600_000, D = 24 * H

let db: FakeDb
const admin = () => createFakeClient(db) as unknown as SupabaseClient<Database>
const bet = (user: string, over: Record<string, unknown> = {}) =>
  db.seed('bets', { user_id: user, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'claimed', created_at: ago(2 * H), expires_at: ago(-20 * H), capture_lat: -34, capture_lng: 22, capture_distance_m: 50, ...over })[0]
const rules = (r: { flags: RiskFlag[] } | null) => (r?.flags ?? []).map(f => f.rule).sort()

beforeEach(() => {
  db = new FakeDb()
  _resetSaltWarning()
  vi.stubEnv('RISK_HASH_SALT', SALT)
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  adminAuth.requireAdmin.mockImplementation(async () => ({ ok: true, user: { id: USER_B.id }, adminClient: createFakeClient(db) }))
  db.seed('profiles', { id: USER_A.id, name: 'Alice', email: USER_A.email, created_at: ago(30 * D) }, { id: USER_B.id, name: 'Bob', email: USER_B.email, created_at: ago(30 * D) }, { id: USER_C.id, name: 'Cara', email: USER_C.email, created_at: ago(30 * D) })
  db.seed('courses', { id: COURSE_ID, name: 'Fancourt', lat: -34, lng: 22 })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('hashIdentifier', () => {
  it('is stable, salted, kind-scoped and case-insensitive', () => {
    const a = hashIdentifier('ip', '196.0.0.1')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(hashIdentifier('ip', '196.0.0.1 ')).toBe(a)
    expect(hashIdentifier('ua', '196.0.0.1')).not.toBe(a)
    expect(hashIdentifier('email', 'Alice@Example.com')).toBe(hashIdentifier('email', 'alice@example.com'))
    expect(hashIdentifier('ip', '196.0.0.1', { RISK_HASH_SALT: 'another-salt-that-is-long' })).not.toBe(a)
  })
  it('returns null for empty or unknown values and when the salt is missing or short, warning once', () => {
    expect(hashIdentifier('ip', '')).toBeNull()
    expect(hashIdentifier('ip', 'unknown')).toBeNull()
    expect(hashIdentifier('ip', '1.2.3.4', {})).toBeNull()
    expect(hashIdentifier('ip', '1.2.3.4', { RISK_HASH_SALT: 'short' })).toBeNull()
    expect((console.error as ReturnType<typeof vi.fn>).mock.calls.filter(c => String(c[0]).includes('risk.salt_missing'))).toHaveLength(1)
  })
})

describe('evaluateClaimRisk', () => {
  it('a clean second bet by an established account, on location, fires nothing', async () => {
    bet(USER_A.id, { status: 'miss', created_at: ago(10 * D) })
    const b = bet(USER_A.id, { video_uploaded_at: ago(H), capture_ended_at: ago(H + 60_000) })
    const r = await evaluateClaimRisk(admin(), b.id as string, NOW)
    expect(rules(r)).toEqual([])
    expect(r?.score).toBe(0)
  })

  it('first_bet_win and no_location on a fresh account with no position', async () => {
    db.find('profiles', p => p.id === USER_A.id)!.created_at = ago(3 * H)
    const b = bet(USER_A.id, { capture_lat: null, capture_lng: null, capture_distance_m: null })
    const r = await evaluateClaimRisk(admin(), b.id as string, NOW)
    expect(rules(r)).toEqual(['first_bet_win', 'no_location'])
    expect(r?.score).toBe(3)
    expect(r?.flags.find(f => f.rule === 'first_bet_win')?.detail).toMatchObject({ first_bet: true, account_age_hours: 1 })
  })

  it('repeat_claimant counts other claims in the window and rejected ones ever', async () => {
    const old = bet(USER_A.id, { status: 'claimed', created_at: ago(100 * D) })
    db.seed('verifications', { bet_id: old.id, status: 'rejected' })
    bet(USER_A.id, { status: 'paid', created_at: ago(400 * D) })  // outside the window, but a paid one is still not a repeat here
    const b = bet(USER_A.id)
    const r = await evaluateClaimRisk(admin(), b.id as string, NOW)
    expect(r?.flags.find(f => f.rule === 'repeat_claimant')?.detail).toEqual({ other_claims: 1, rejected: 1 })
  })

  it('shared_ip and shared_device across accounts within the window', async () => {
    const ip = hashIdentifier('ip', '10.0.0.1'), ua = hashIdentifier('ua', 'Phone/1')
    bet(USER_B.id, { status: 'miss', created_ip_hash: ip, created_at: ago(5 * D) })
    bet(USER_C.id, { claim_ip_hash: ip, claim_ua_hash: ua, created_at: ago(2 * D) })
    bet(USER_C.id, { claim_ip_hash: ip, claim_ua_hash: ua, created_at: ago(60 * D) }) // too old
    const b = bet(USER_A.id, { status: 'miss', created_at: ago(10 * D) }) && bet(USER_A.id, { claim_ip_hash: ip, claim_ua_hash: ua })
    const r = await evaluateClaimRisk(admin(), b.id as string, NOW)
    expect(r?.flags.find(f => f.rule === 'shared_ip')?.detail).toEqual({ accounts: 2, window_days: THRESHOLDS.sharedIpWindowDays })
    expect(r?.flags.find(f => f.rule === 'shared_device')?.detail).toEqual({ accounts: 1 })
  })

  it('upload_lag: long after recording, or long after the bet', async () => {
    bet(USER_A.id, { status: 'miss', created_at: ago(10 * D) })
    const slow = bet(USER_A.id, { capture_ended_at: ago(2 * H), video_uploaded_at: ago(H) })
    const late = bet(USER_A.id, { created_at: ago(20 * H), capture_ended_at: null, video_uploaded_at: ago(H) })
    const fine = bet(USER_A.id, { capture_ended_at: ago(H + 30_000), video_uploaded_at: ago(H) })
    expect((await evaluateClaimRisk(admin(), slow.id as string, NOW))?.flags.find(f => f.rule === 'upload_lag')?.detail).toMatchObject({ after_recording_s: 3600 })
    expect((await evaluateClaimRisk(admin(), late.id as string, NOW))?.flags.find(f => f.rule === 'upload_lag')?.detail).toMatchObject({ after_recording_s: null, after_bet_hours: 19 })
    expect(rules(await evaluateClaimRisk(admin(), fine.id as string, NOW))).not.toContain('upload_lag')
  })

  it('far_from_course over the threshold; duplicate footage and documents', async () => {
    bet(USER_A.id, { status: 'miss', created_at: ago(10 * D) })
    const other = bet(USER_B.id, { video_sha256: 'same-video' })
    db.seed('verifications', { bet_id: other.id, status: 'documents_received', certificate_sha256: 'same-cert' })
    const b = bet(USER_A.id, { capture_distance_m: 3500, video_sha256: 'same-video' })
    db.seed('verifications', { bet_id: b.id, status: 'documents_received', affidavit_sha256: 'same-cert' })
    const r = await evaluateClaimRisk(admin(), b.id as string, NOW)
    expect(rules(r)).toEqual(['duplicate_media', 'duplicate_media', 'far_from_course', 'repeat_claimant'].sort().filter(x => x !== 'repeat_claimant'))
    expect(r?.flags.filter(f => f.rule === 'duplicate_media').map(f => f.detail)).toEqual([{ footage: true, matches: 1 }, { footage: false, matches: 1 }])
    expect(r?.flags.find(f => f.rule === 'far_from_course')?.detail).toEqual({ distance_m: 3500 })
  })

  it('witness_overlap: a witness who holds an account, or who appears on another claim', async () => {
    bet(USER_A.id, { status: 'miss', created_at: ago(10 * D) })
    const other = bet(USER_C.id)
    db.seed('claim_witnesses', { bet_id: other.id, role: 'witness', name: 'Repeat', email: 'repeat@example.com' })
    const b = bet(USER_A.id)
    db.seed('claim_witnesses', { bet_id: b.id, role: 'witness', name: 'Bob', email: USER_B.email }, { bet_id: b.id, role: 'witness', name: 'Repeat', email: 'repeat@example.com' })
    const r = await evaluateClaimRisk(admin(), b.id as string, NOW)
    expect(r?.flags.find(f => f.rule === 'witness_overlap')?.detail).toEqual({ account_holders: 1, other_claims: 1 })
  })

  it('hole_cluster at the threshold within the window, not at another hole', async () => {
    bet(USER_A.id, { status: 'miss', created_at: ago(10 * D) })
    bet(USER_B.id, { created_at: ago(D) }); bet(USER_C.id, { status: 'verified', created_at: ago(3 * D) })
    bet(USER_C.id, { hole_id: HOLE_2, created_at: ago(D) })
    const b = bet(USER_A.id)
    const r = await evaluateClaimRisk(admin(), b.id as string, NOW)
    expect(r?.flags.find(f => f.rule === 'hole_cluster')?.detail).toEqual({ claims: 3, window_days: THRESHOLDS.holeClusterWindowDays })
  })

  it('deleted_and_back when a deleted account had this email', async () => {
    bet(USER_A.id, { status: 'miss', created_at: ago(10 * D) })
    db.seed('deleted_accounts', { email_hash: hashIdentifier('email', USER_A.email), bets: 4, claims: 1 })
    const b = bet(USER_A.id)
    expect((await evaluateClaimRisk(admin(), b.id as string, NOW))?.flags.find(f => f.rule === 'deleted_and_back')?.detail).toEqual({ previous_bets: 4 })
  })

  it('returns null for an unknown bet', async () => {
    expect(await evaluateClaimRisk(admin(), '00000000-0000-4000-8000-000000000000', NOW)).toBeNull()
  })

  it('every rule has a label and a one-line description', () => {
    for (const rule of Object.keys(RULE_LABELS) as RiskFlag['rule'][]) {
      expect(describeFlag({ rule, severity: 'low', detail: { other_claims: 1, rejected: 0, first_bet: true, accounts: 1, window_days: 30, after_recording_s: 1200, after_bet_hours: 2, distance_m: 2500, footage: true, matches: 1, account_holders: 1, other_claims_w: 0, claims: 3, previous_bets: 2 } })).toBeTruthy()
    }
  })
})

describe('refreshClaimRisk', () => {
  it('writes flags and score to the bet, and only rewrites them when they change', async () => {
    const b = bet(USER_A.id, { capture_lat: null, capture_lng: null, capture_distance_m: null })
    await refreshClaimRisk(admin(), b.id as string, NOW)
    expect(b.risk_score).toBe(3)
    expect((b.risk_flags as RiskFlag[]).map(f => f.rule)).toEqual(['first_bet_win', 'no_location'])
    const logged = () => (console.log as ReturnType<typeof vi.fn>).mock.calls.filter(c => String(c[0]).includes('risk.flags_changed')).length
    expect(logged()).toBe(1)
    await refreshClaimRisk(admin(), b.id as string, new Date(NOW.getTime() + 60_000))
    expect(logged()).toBe(1)
    expect(b.risk_evaluated_at).toBe(new Date(NOW.getTime() + 60_000).toISOString())
  })
})

describe('claim submission records signals and evaluates', () => {
  it('stores hashed ip and user agent on the bet and writes the flags', async () => {
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const b = bet(USER_A.id, { status: 'active', created_at: ago(H) })
    db.putObject('verification-docs', `${USER_A.id}/${b.id}/certificate/c.pdf`, 'x')
    const res = await submitClaim(jsonRequest('http://x', {
      certificatePath: `${USER_A.id}/${b.id}/certificate/c.pdf`,
      witnesses: [{ role: 'witness', name: 'Sipho Dlamini', email: 'sipho@example.com' }],
    }, { headers: { 'x-forwarded-for': '196.1.1.1', 'user-agent': 'Phone/1' } }) as never, { params: Promise.resolve({ betId: b.id as string }) })
    expect(res.status).toBe(200)
    expect(b).toMatchObject({ status: 'claimed', claim_ip_hash: hashIdentifier('ip', '196.1.1.1'), claim_ua_hash: hashIdentifier('ua', 'Phone/1') })
    expect((b.risk_flags as RiskFlag[]).map(f => f.rule)).toEqual(['first_bet_win'])
    expect(b.risk_score).toBe(2)
  })
})

describe('admin review discipline', () => {
  const params = (verificationId: string) => ({ params: Promise.resolve({ verificationId }) })
  const CHECKLIST = Object.fromEntries(REVIEW_CHECKLIST.map(i => [i.key, true]))
  const NOTES = 'Phoned the pro shop; certificate confirmed by the club manager. Flags addressed.'

  it('detail re-evaluates and returns the flags; queue shows the count and sorts by risk', async () => {
    bet(USER_A.id, { status: 'miss', created_at: ago(10 * D) })
    const flagged = bet(USER_A.id, { capture_lat: null, capture_lng: null, capture_distance_m: null })
    bet(USER_B.id, { status: 'miss', created_at: ago(10 * D) })
    const clean = bet(USER_B.id, { hole_id: HOLE_2 })
    const [vf] = db.seed('verifications', { bet_id: flagged.id, status: 'documents_received' })
    const [vc] = db.seed('verifications', { bet_id: clean.id, status: 'documents_received' })
    const detail = await (await adminDetail(new Request('http://x') as never, params(vf.id as string))).json()
    expect(detail.riskFlags.map((f: RiskFlag) => f.rule)).toEqual(['no_location'])
    expect(detail.riskScore).toBe(1)
    await adminDetail(new Request('http://x') as never, params(vc.id as string))
    const list = await (await queue(new Request('http://x/api/admin/verifications?sort=risk') as never)).json()
    expect(list.data.map((i: { id: string; riskFlagCount: number }) => [i.id, i.riskFlagCount])).toEqual([[vf.id, 1], [vc.id, 0]])
  })

  it('approve needs every checklist item and a reason; reject needs a reason', async () => {
    const b = bet(USER_A.id)
    const [v] = db.seed('verifications', { bet_id: b.id, status: 'documents_received' })
    const patch = (body: unknown) => adminReview(jsonRequest('http://x', body, { method: 'PATCH' }) as never, params(v.id as string))
    expect(await (await patch({ status: 'approved', reviewerNotes: NOTES })).json()).toMatchObject({ code: 'CHECKLIST_INCOMPLETE' })
    expect(await (await patch({ status: 'approved', reviewerNotes: NOTES, checklist: { ...CHECKLIST, flags_reviewed: false } })).json()).toMatchObject({ code: 'CHECKLIST_INCOMPLETE' })
    expect(await (await patch({ status: 'approved', reviewerNotes: 'ok', checklist: CHECKLIST })).json()).toMatchObject({ code: 'NOTES_REQUIRED' })
    expect(await (await patch({ status: 'rejected', reviewerNotes: 'no' })).json()).toMatchObject({ code: 'NOTES_REQUIRED' })
    expect(v.status).toBe('documents_received')
    expect((await patch({ status: 'under_review' })).status).toBe(200)
    const ok = await patch({ status: 'approved', reviewerNotes: NOTES, checklist: CHECKLIST })
    expect(ok.status).toBe(200)
    expect(v.review_checklist).toMatchObject({ ...CHECKLIST, completed_by: USER_B.id })
    expect(b.status).toBe('verified')
  })

  it('batch approve records that no checklist was done; batch reject needs a reason', async () => {
    const b = bet(USER_A.id)
    const [v] = db.seed('verifications', { bet_id: b.id, status: 'under_review' })
    expect((await batchReview(jsonRequest('http://x', { ids: [v.id], action: 'reject' }) as never)).status).toBe(400)
    const res = await batchReview(jsonRequest('http://x', { ids: [v.id], action: 'approve', notes: 'Reviewed together with the club on the phone.' }) as never)
    expect(res.status).toBe(200)
    expect(v.review_checklist).toMatchObject({ batch: true, completed_by: USER_B.id })
  })

  it('paid needs a payout reference and stamps the verification', async () => {
    const b = bet(USER_A.id, { status: 'verified' })
    const [v] = db.seed('verifications', { bet_id: b.id, status: 'approved' })
    const patch = (body: unknown) => adminBet(jsonRequest('http://x', body, { method: 'PATCH' }) as never, { params: Promise.resolve({ betId: b.id as string }) })
    expect(await (await patch({ status: 'paid' })).json()).toMatchObject({ code: 'PAYOUT_REFERENCE_REQUIRED' })
    expect(await (await patch({ status: 'paid', payoutReference: 'ab' })).json()).toMatchObject({ code: 'PAYOUT_REFERENCE_REQUIRED' })
    expect(b.status).toBe('verified')
    expect((await patch({ status: 'paid', payoutReference: 'FNB-0042' })).status).toBe(200)
    expect(b).toMatchObject({ status: 'paid', payout_reference: 'FNB-0042' })
    expect(typeof v.payout_initiated_at).toBe('string')
    expect(v.updated_by).toBe(USER_B.id)
  })
})

describe('account deletion leaves a hashed memory', () => {
  it('records the email hash with bet and claim counts, and nothing else', async () => {
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    bet(USER_A.id, { status: 'miss' }); bet(USER_A.id, { status: 'claimed' })
    db.seed('verifications', { bet_id: db.rows('bets')[1].id, status: 'rejected' })
    const res = await deleteAccount(new Request('http://x', { method: 'DELETE' }) as never)
    expect(res.status).toBe(200)
    expect(db.rows('deleted_accounts')).toMatchObject([{ email_hash: hashIdentifier('email', USER_A.email), bets: 2, claims: 1 }])
    expect(Object.keys(db.rows('deleted_accounts')[0]).sort()).toEqual(['bets', 'claims', 'created_at', 'email_hash', 'id'])
  })
})
