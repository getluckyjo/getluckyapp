/**
 * Evidence capture (Stage 4, Batch 9): what the recorder attests, what the
 * server keeps of it, document hashes, and the people named on a claim.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'
import { captureColumns, distanceMetres, CaptureSchema } from '@/lib/claims/capture'
import { POST as uploadUrl } from '@/app/api/videos/upload-url/route'
import { POST as submitClaim } from '@/app/api/verifications/[betId]/route'
import { GET as adminDetail } from '@/app/api/admin/verifications/[verificationId]/route'
import { runRetention } from '@/lib/retention'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
const adminAuth = vi.hoisted(() => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)
vi.mock('@/lib/admin-auth', () => adminAuth)

let db: FakeDb
const IN_WINDOW = new Date(Date.now() + 6 * 3_600_000).toISOString()
const FANCOURT = { lat: -34.0186, lng: 22.4064 }   // roughly George, Western Cape
const asUser = (user = USER_A) => serverClient.createClient.mockResolvedValue(createFakeClient(db, { user }))
const ownBet = (over: Record<string, unknown> = {}) =>
  db.seed('bets', { user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'active', expires_at: IN_WINDOW, ...over })[0]
const params = (betId: string) => ({ params: Promise.resolve({ betId }) })
const NOW = Date.now()
const capture = (over: Record<string, unknown> = {}) => ({
  startedAt: new Date(NOW - 40_000).toISOString(), endedAt: new Date(NOW - 10_000).toISOString(), durationMs: 30_000, ...over,
})

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  db.seed('courses', { id: COURSE_ID, name: 'Fancourt', lat: FANCOURT.lat, lng: FANCOURT.lng })
  db.seed('profiles', { id: USER_A.id, name: 'Alice' })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('captureColumns', () => {
  const course = FANCOURT
  it('keeps a consistent timeline and computes the distance to the course', () => {
    const cols = captureColumns(capture({ lat: -34.0190, lng: 22.4070, accuracyM: 12.4 }), { course, userAgent: 'Mozilla/5.0 (iPhone)', now: NOW })
    expect(cols.capture_duration_ms).toBe(30_000)
    expect(cols.capture_started_at).toBe(new Date(NOW - 40_000).toISOString())
    expect(cols.capture_accuracy_m).toBe(12)
    expect(cols.capture_distance_m).toBeGreaterThan(50)
    expect(cols.capture_distance_m).toBeLessThan(120)
    expect(cols.capture_user_agent).toBe('Mozilla/5.0 (iPhone)')
  })

  it('drops timestamps that cannot be true but keeps the position', () => {
    const cases = [
      capture({ endedAt: new Date(NOW - 50_000).toISOString() }),                 // ends before it starts
      capture({ durationMs: 5_000 }),                                              // duration disagrees with the timestamps
      capture({ startedAt: new Date(NOW + 600_000).toISOString(), endedAt: new Date(NOW + 630_000).toISOString() }), // from the future
      capture({ startedAt: new Date(NOW - 3 * 86_400_000).toISOString(), endedAt: new Date(NOW - 3 * 86_400_000 + 30_000).toISOString() }), // three days old
    ]
    for (const c of cases) {
      const cols = captureColumns({ ...c, lat: -34, lng: 22 }, { course, userAgent: null, now: NOW })
      expect(cols.capture_started_at, JSON.stringify(c)).toBeNull()
      expect(cols.capture_lat).toBe(-34)
    }
  })

  it('no position → no distance; position but no course coordinates → no distance', () => {
    expect(captureColumns(capture(), { course, userAgent: null, now: NOW }).capture_distance_m).toBeNull()
    expect(captureColumns(capture({ lat: -34, lng: 22 }), { course: { lat: null, lng: null }, userAgent: null, now: NOW }).capture_distance_m).toBeNull()
  })

  it('nothing reported → only the user agent', () => {
    const cols = captureColumns(undefined, { course, userAgent: 'x'.repeat(500) })
    expect(cols.capture_started_at).toBeNull()
    expect(cols.capture_user_agent).toHaveLength(300)
  })

  it('distanceMetres: Cape Town to Johannesburg is about 1 260 km', () => {
    expect(distanceMetres({ lat: -33.9249, lng: 18.4241 }, { lat: -26.2041, lng: 28.0473 }) / 1000).toBeCloseTo(1262, -1)
  })

  it('schema rejects impossible coordinates and over-long recordings', () => {
    expect(CaptureSchema.safeParse(capture({ lat: 95, lng: 0 })).success).toBe(false)
    expect(CaptureSchema.safeParse(capture({ durationMs: 500_000 })).success).toBe(false)
    expect(CaptureSchema.safeParse(capture({ startedAt: 'yesterday' })).success).toBe(false)
  })
})

describe('POST /api/videos/upload-url — capture attestation', () => {
  const call = (body: unknown, ua = 'TestPhone/1.0') =>
    uploadUrl(jsonRequest('http://x', body, { headers: { 'user-agent': ua } }) as never)

  it('stores the recorder report and the distance on the bet', async () => {
    asUser()
    const bet = ownBet()
    const res = await call({ betId: bet.id, capture: capture({ lat: -34.0190, lng: 22.4070, accuracyM: 8 }) })
    expect(res.status).toBe(200)
    expect(bet).toMatchObject({ capture_duration_ms: 30_000, capture_lat: -34.019, capture_accuracy_m: 8, capture_user_agent: 'TestPhone/1.0' })
    expect(bet.capture_distance_m).toBeGreaterThan(50)
  })

  it('works without a report (older app) and records the device only', async () => {
    asUser()
    const bet = ownBet()
    expect((await call({ betId: bet.id })).status).toBe(200)
    expect(bet).toMatchObject({ capture_started_at: null, capture_lat: null, capture_user_agent: 'TestPhone/1.0' })
  })

  it('does not overwrite the report once the footage is sealed', async () => {
    asUser()
    const bet = ownBet({ video_sha256: 'sealed', capture_lat: -34, capture_lng: 22, capture_distance_m: 10 })
    expect((await call({ betId: bet.id, capture: capture({ lat: 0, lng: 0 }) })).status).toBe(200)
    expect(bet).toMatchObject({ capture_lat: -34, capture_distance_m: 10 })
  })

  it('rejects a malformed report', async () => {
    asUser()
    const bet = ownBet()
    expect((await call({ betId: bet.id, capture: { startedAt: 'now' } })).status).toBe(400)
  })
})

describe('POST /api/verifications/[betId] — documents and witnesses', () => {
  const submit = (betId: string, body: unknown) => submitClaim(jsonRequest('http://x', body) as never, params(betId))
  const PARTNER = { role: 'witness', name: 'Sipho Dlamini', email: 'Sipho@Example.com ' }
  const OFFICIAL = { role: 'club_official', name: 'Pro Shop', email: 'pro@club.example' }
  const withDoc = (bet: Record<string, unknown>, kind: string, bytes: string) => {
    const p = `${USER_A.id}/${bet.id}/${kind}/1-${kind}.pdf`
    db.putObject('verification-docs', p, bytes)
    return p
  }

  it('hashes each document as read back from storage and records the witnesses', async () => {
    asUser()
    const bet = ownBet()
    const certificatePath = withDoc(bet, 'certificate', 'certificate bytes')
    const affidavitPath = withDoc(bet, 'affidavit', 'affidavit bytes')
    const res = await submit(bet.id as string, { certificatePath, affidavitPath, witnesses: [PARTNER, OFFICIAL] })
    expect(res.status).toBe(200)
    const [v] = db.rows('verifications')
    expect(v).toMatchObject({
      certificate_sha256: createHash('sha256').update('certificate bytes').digest('hex'), certificate_bytes: 17,
      affidavit_sha256: createHash('sha256').update('affidavit bytes').digest('hex'), affidavit_bytes: 15,
    })
    const named = db.rows('claim_witnesses')
    expect(named.map(w => [w.role, w.name, w.email, w.bet_id, w.verification_id])).toEqual([
      ['witness', 'Sipho Dlamini', 'sipho@example.com', bet.id, v.id],
      ['club_official', 'Pro Shop', 'pro@club.example', bet.id, v.id],
    ])
  })

  it('400 DOCUMENT_MISSING when a named document never landed, and the bet stays active', async () => {
    asUser()
    const bet = ownBet()
    const res = await submit(bet.id as string, { certificatePath: `${USER_A.id}/${bet.id}/certificate/never.pdf`, witnesses: [PARTNER] })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'DOCUMENT_MISSING' })
    expect(bet.status).toBe('active')
    expect(db.rows('verifications')).toHaveLength(0)
  })

  it('400 WITNESS_REQUIRED without a playing partner; a club official alone is not enough', async () => {
    asUser()
    const bet = ownBet()
    const certificatePath = withDoc(bet, 'certificate', 'x')
    for (const witnesses of [undefined, [], [OFFICIAL]]) {
      const res = await submit(bet.id as string, { certificatePath, witnesses })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'WITNESS_REQUIRED' })
    }
    expect(bet.status).toBe('active')
  })

  it('a resubmission without witnesses keeps the earlier list; with witnesses replaces it', async () => {
    asUser()
    const bet = ownBet()
    const certificatePath = withDoc(bet, 'certificate', 'x')
    expect((await submit(bet.id as string, { certificatePath, witnesses: [PARTNER] })).status).toBe(200)
    const affidavitPath = withDoc(bet, 'affidavit', 'y')
    expect((await submit(bet.id as string, { affidavitPath })).status).toBe(200)
    expect(db.rows('claim_witnesses').map(w => w.name)).toEqual(['Sipho Dlamini'])
    expect((await submit(bet.id as string, { affidavitPath, witnesses: [{ ...PARTNER, name: 'Thandi Nkosi', email: 't@example.com' }, OFFICIAL] })).status).toBe(200)
    expect(db.rows('claim_witnesses').map(w => w.name)).toEqual(['Thandi Nkosi', 'Pro Shop'])
  })

  it('rejects bad witness input', async () => {
    asUser()
    const bet = ownBet()
    const certificatePath = withDoc(bet, 'certificate', 'x')
    for (const witnesses of [[{ role: 'witness', name: 'A', email: 'a@b.c' }], [{ role: 'witness', name: 'Anna', email: 'not-an-email' }], [{ role: 'caddie', name: 'Anna', email: 'a@b.c' }], new Array(5).fill(PARTNER)]) {
      expect((await submit(bet.id as string, { certificatePath, witnesses })).status, JSON.stringify(witnesses)).toBe(400)
    }
  })
})

describe('GET /api/admin/verifications/[id] — what the reviewer sees', () => {
  it('includes the recorder report, upload lag, document hashes and witnesses', async () => {
    const admin = createFakeClient(db)
    adminAuth.requireAdmin.mockResolvedValue({ ok: true, user: { id: USER_B.id }, adminClient: admin })
    const ended = new Date(NOW - 10_000).toISOString()
    const bet = ownBet({
      status: 'claimed', capture_started_at: new Date(NOW - 40_000).toISOString(), capture_ended_at: ended, capture_duration_ms: 30_000,
      capture_lat: -34.019, capture_lng: 22.407, capture_accuracy_m: 8, capture_distance_m: 90, capture_user_agent: 'TestPhone/1.0',
      video_uploaded_at: new Date(NOW + 50_000).toISOString(),
    })
    const [v] = db.seed('verifications', { bet_id: bet.id, status: 'documents_received', certificate_sha256: 'abc', certificate_bytes: 10 })
    db.seed('claim_witnesses', { bet_id: bet.id, verification_id: v.id, role: 'witness', name: 'Sipho', email: 's@example.com' })

    const res = await adminDetail(new Request('http://x') as never, { params: Promise.resolve({ verificationId: v.id as string }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.capture).toMatchObject({ durationMs: 30_000, distanceM: 90, accuracyM: 8, userAgent: 'TestPhone/1.0', uploadLagS: 60 })
    expect(body.certificateSeal).toEqual({ sha256: 'abc', bytes: 10 })
    expect(body.affidavitSeal).toEqual({ sha256: null, bytes: null })
    expect(body.witnesses).toMatchObject([{ role: 'witness', name: 'Sipho', email: 's@example.com' }])
  })

  it('includes the player\'s standing, the payment, the hole, and a download link beside each document', async () => {
    adminAuth.requireAdmin.mockResolvedValue({ ok: true, user: { id: USER_B.id }, adminClient: createFakeClient(db) })
    const p = db.find('profiles', r => r.id === USER_A.id)!
    Object.assign(p, { email: USER_A.email, suspended_at: '2026-09-20T08:00:00Z', suspended_reason: 'Chargeback', age_verified_at: null })
    db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 7, par: 3, distance_metres: 162 })
    const bet = ownBet({ status: 'claimed', stake_pence: 5000, payment_intent_id: 'gl_pay_1', video_url: `${USER_A.id}/b/shot.mp4` })
    db.seed('payfast_payments', { m_payment_id: 'gl_pay_1', bet_id: bet.id, amount_cents: 5000, status: 'pending', created_at: '2026-09-20T07:00:00Z' })
    const [v] = db.seed('verifications', { bet_id: bet.id, status: 'documents_received', certificate_path: `${USER_A.id}/b/certificate/c.pdf` })

    const body = await (await adminDetail(new Request('http://x') as never, { params: Promise.resolve({ verificationId: v.id as string }) })).json()
    expect(body.player).toEqual({ email: USER_A.email, suspendedAt: '2026-09-20T08:00:00Z', suspendedReason: 'Chargeback', ageVerifiedAt: null })
    expect(body.payment).toEqual({ status: 'pending', amountCents: 5000, reference: 'gl_pay_1' })
    expect(body.hole).toEqual({ par: 3, distanceMetres: 162 })
    expect(body.certificateSignedUrl).toBe(`https://storage.example/signed/${USER_A.id}/b/certificate/c.pdf`)
    expect(typeof body.certificateDownloadUrl).toBe('string')
    expect(body.affidavitSignedUrl).toBeNull()
    expect(body.unsignedMedia).toEqual([])
    expect(typeof body.signedAt).toBe('string')
  })

  it('a free swing has no payment; a paid swing with no ledger row says so', async () => {
    adminAuth.requireAdmin.mockResolvedValue({ ok: true, user: { id: USER_B.id }, adminClient: createFakeClient(db) })
    const free = ownBet({ status: 'claimed', stake_pence: 0, payment_intent_id: `free_${USER_A.id}` })
    const paid = ownBet({ status: 'claimed', stake_pence: 5000, payment_intent_id: 'gl_gone' })
    const [vFree] = db.seed('verifications', { bet_id: free.id, status: 'pending' })
    const [vPaid] = db.seed('verifications', { bet_id: paid.id, status: 'pending' })
    const get = async (id: unknown) => (await adminDetail(new Request('http://x?fresh=0') as never, { params: Promise.resolve({ verificationId: id as string }) })).json()
    expect((await get(vFree.id)).payment).toBeNull()
    expect((await get(vPaid.id)).payment).toEqual({ status: 'missing', amountCents: null, reference: 'gl_gone' })
  })

  it('a link that cannot be signed is reported as such, not as missing evidence', async () => {
    const base = createFakeClient(db)
    const brokenStorage = { ...base, storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'storage down' } }) }) } }
    adminAuth.requireAdmin.mockResolvedValue({ ok: true, user: { id: USER_B.id }, adminClient: brokenStorage })
    const bet = ownBet({ status: 'claimed', video_url: `${USER_A.id}/b/shot.mp4` })
    const [v] = db.seed('verifications', { bet_id: bet.id, status: 'documents_received', certificate_path: `${USER_A.id}/b/certificate/c.jpg` })
    const res = await adminDetail(new Request('http://x?fresh=0') as never, { params: Promise.resolve({ verificationId: v.id as string }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ videoSignedUrl: null, certificateSignedUrl: null, affidavitSignedUrl: null })
    expect(body.unsignedMedia.sort()).toEqual(['certificate', 'video'])
  })

  it('404 only for a claim that does not exist; a failed read is a 500', async () => {
    adminAuth.requireAdmin.mockResolvedValue({ ok: true, user: { id: USER_B.id }, adminClient: createFakeClient(db) })
    const missing = await adminDetail(new Request('http://x') as never, { params: Promise.resolve({ verificationId: '99999999-9999-4999-8999-999999999999' }) })
    expect(missing.status).toBe(404)
    adminAuth.requireAdmin.mockResolvedValue({ ok: true, user: { id: USER_B.id }, adminClient: createFakeClient(db, { failTable: { verifications: { code: '57014', message: 'timeout', details: '', hint: '' } } }) })
    const failed = await adminDetail(new Request('http://x') as never, { params: Promise.resolve({ verificationId: '99999999-9999-4999-8999-999999999999' }) })
    expect(failed.status).toBe(500)
  })
})

describe('retention — witnesses go with a rejected claim', () => {
  it('deletes the named people when the documents are purged', async () => {
    const bet = ownBet({ status: 'claimed' })
    const [v] = db.seed('verifications', { bet_id: bet.id, status: 'rejected', updated_at: new Date(NOW - 100 * 86_400_000).toISOString() })
    db.seed('claim_witnesses', { bet_id: bet.id, verification_id: v.id, role: 'witness', name: 'Sipho', email: 's@example.com' })
    const keep = ownBet({ status: 'claimed' })
    db.seed('claim_witnesses', { bet_id: keep.id, role: 'witness', name: 'Keep', email: 'k@example.com' })
    await runRetention(createFakeClient(db) as unknown as SupabaseClient<Database>, { now: new Date(NOW) })
    expect(db.rows('claim_witnesses').map(w => w.name)).toEqual(['Keep'])
  })
})
