/**
 * Independent confirmation (Stage 4, Batch 11): witness and club emails with
 * one-time links, the public answer page, standing course contacts, and the
 * evidence pack.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'
import { sendWitnessRequests, lookupToken, hashToken } from '@/lib/claims/confirmation'
import { replaceWitnesses } from '@/lib/claims/witnesses'
import { buildWitnessRequest } from '@/lib/email/witness-request'
import { POST as submitClaim } from '@/app/api/verifications/[betId]/route'
import { GET as witnessGet, POST as witnessPost } from '@/app/api/witness/[token]/route'
import { GET as adminDetail } from '@/app/api/admin/verifications/[verificationId]/route'
import { POST as resendRequests } from '@/app/api/admin/verifications/[verificationId]/witness-requests/route'
import { GET as evidencePack } from '@/app/api/admin/verifications/[verificationId]/evidence-pack/route'
import { POST as addContact, DELETE as removeContact } from '@/app/api/admin/courses/[courseId]/contacts/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
const adminAuth = vi.hoisted(() => ({ requireAdmin: vi.fn() }))
const resendMock = vi.hoisted(() => ({ resend: { emails: { send: vi.fn() } } }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)
vi.mock('@/lib/admin-auth', () => adminAuth)
vi.mock('@/lib/resend', () => resendMock)

let db: FakeDb
const admin = () => createFakeClient(db) as unknown as SupabaseClient<Database>
const bet = (over: Record<string, unknown> = {}) =>
  db.seed('bets', { user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'claimed', declared_at: '2026-09-12T14:00:00Z', expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(), ...over })[0]
const sentTo = () => resendMock.resend.emails.send.mock.calls.map(c => c[0] as { to: string; subject: string; html: string; text: string })
const tokenFrom = (mail: { text: string }) => mail.text.match(/\/witness\/([A-Za-z0-9_-]+)/)![1]
const vp = (verificationId: string) => ({ params: Promise.resolve({ verificationId }) })
const tp = (token: string) => ({ params: Promise.resolve({ token }) })

beforeEach(() => {
  db = new FakeDb()
  vi.stubEnv('RISK_HASH_SALT', 'a-salt-long-enough-for-tests')
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.example')
  serverClient.createClient.mockReset()
  resendMock.resend.emails.send.mockReset().mockResolvedValue({ data: { id: 'email-1' }, error: null })
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  adminAuth.requireAdmin.mockImplementation(async () => ({ ok: true, user: { id: USER_B.id }, adminClient: createFakeClient(db) }))
  db.seed('profiles', { id: USER_A.id, name: 'Alice Ace', email: USER_A.email }, { id: USER_B.id, name: 'Bob', email: USER_B.email })
  db.seed('courses', { id: COURSE_ID, name: 'Fancourt', lat: -34, lng: 22 })
  db.seed('holes', { id: HOLE_ID, course_id: COURSE_ID, hole_number: 7, par: 3 })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('the email', () => {
  it('asks one question per role and carries the link once', () => {
    const w = buildWitnessRequest({ role: 'witness', witnessName: 'Sipho Dlamini', golferName: 'Alice Ace', courseName: 'Fancourt', holeNumber: 7, playedOn: '12 September 2026', token: 'tok_abc' })
    expect(w.subject).toBe("Did you see Alice Ace's hole-in-one?")
    expect(w.text).toContain('https://preview.example/witness/tok_abc')
    expect(w.html).toContain('Did you see the ball go in?')
    const c = buildWitnessRequest({ role: 'club_official', witnessName: 'Pro Shop', golferName: 'Alice Ace', courseName: 'Fancourt', holeNumber: 7, playedOn: '12 September 2026', token: 'tok_abc' })
    expect(c.subject).toContain('certify')
    expect(c.html).toContain('Did your club issue that certificate?')
    expect(c.html).not.toContain('<script')
  })
})

describe('sendWitnessRequests', () => {
  it('emails each unasked person a one-time link, stores only the hash, and skips those already asked or answered', async () => {
    const b = bet()
    const [v] = db.seed('verifications', { bet_id: b.id, status: 'documents_received' })
    const [w1, w2, w3] = db.seed('claim_witnesses',
      { bet_id: b.id, verification_id: v.id, role: 'witness', name: 'Sipho Dlamini', email: 'sipho@example.com' },
      { bet_id: b.id, verification_id: v.id, role: 'club_official', name: 'Pro Shop', email: 'pro@club.example', requested_at: '2026-09-13T00:00:00Z', request_count: 1 },
      { bet_id: b.id, verification_id: v.id, role: 'witness', name: 'Done', email: 'done@example.com', response: 'confirmed' },
    )
    const result = await sendWitnessRequests(admin(), b.id as string)
    expect(result).toEqual({ sent: 1, failed: 0 })
    expect(sentTo().map(m => m.to)).toEqual(['sipho@example.com'])
    const token = tokenFrom(sentTo()[0])
    expect(w1.token_hash).toBe(hashToken(token))
    expect(w1.requested_at).toBeTruthy()
    expect(w1.request_count).toBe(1)
    expect(JSON.stringify(w1)).not.toContain(token)
    expect(w2.token_hash).toBeUndefined()
    expect(w3.token_hash).toBeUndefined()
  })

  it('a failed send leaves the row unasked so it is retried; the others still go', async () => {
    const b = bet()
    db.seed('claim_witnesses', { bet_id: b.id, role: 'witness', name: 'A', email: 'a@example.com' }, { bet_id: b.id, role: 'witness', name: 'B', email: 'b@example.com' })
    resendMock.resend.emails.send.mockResolvedValueOnce({ data: null, error: { message: 'bounce' } })
    const result = await sendWitnessRequests(admin(), b.id as string)
    expect(result).toEqual({ sent: 1, failed: 1 })
    const rows = db.rows('claim_witnesses')
    expect(rows.filter(r => r.requested_at)).toHaveLength(1)
    expect(await sendWitnessRequests(admin(), b.id as string)).toEqual({ sent: 1, failed: 0 })
  })

  it('force re-sends to one person with a fresh token, invalidating the old one', async () => {
    const b = bet()
    const [w] = db.seed('claim_witnesses', { bet_id: b.id, role: 'witness', name: 'A', email: 'a@example.com' })
    await sendWitnessRequests(admin(), b.id as string)
    const first = tokenFrom(sentTo()[0])
    await sendWitnessRequests(admin(), b.id as string, { onlyIds: [w.id as string], force: true })
    const second = tokenFrom(sentTo()[1])
    expect(second).not.toBe(first)
    expect(w.request_count).toBe(2)
    expect((await lookupToken(admin(), first)).ok).toBe(false)
    expect((await lookupToken(admin(), second)).ok).toBe(true)
  })
})

describe('the public answer', () => {
  async function asked() {
    const b = bet()
    const [w] = db.seed('claim_witnesses', { bet_id: b.id, role: 'witness', name: 'Sipho Dlamini', email: 'sipho@example.com' })
    await sendWitnessRequests(admin(), b.id as string)
    return { b, w, token: tokenFrom(sentTo().at(-1)!) }
  }
  const get = (token: string, ip = '1.1.1.1') => witnessGet(new Request(`http://x/api/witness/${token}`, { headers: { 'x-forwarded-for': ip } }) as never, tp(token))
  const post = (token: string, body: unknown, ip = '1.1.1.1') => witnessPost(jsonRequest(`http://x/api/witness/${token}`, body, { headers: { 'x-forwarded-for': ip, 'user-agent': 'Phone/1' } }) as never, tp(token))

  it('shows only the first name, course, hole and date; records yes with hashed ip; then the link is spent', async () => {
    const { w, token } = await asked()
    const info = await (await get(token)).json()
    expect(info).toEqual({ ok: true, role: 'witness', witnessName: 'Sipho Dlamini', golferName: 'Alice Ace', courseName: 'Fancourt', holeNumber: 7, playedOn: '12 September 2026' })
    expect(JSON.stringify(info)).not.toContain(USER_A.id)

    const res = await post(token, { answer: 'yes', note: '  I was on the tee  ' })
    expect(res.status).toBe(200)
    expect(w).toMatchObject({ response: 'confirmed', response_note: 'I was on the tee', response_user_agent: 'Phone/1', token_hash: null, token_expires_at: null })
    expect(w.response_ip_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof w.responded_at).toBe('string')

    expect((await get(token)).status).toBe(404)             // hash cleared: the token is gone
    expect((await post(token, { answer: 'no' })).status).toBe(404)
    expect(w.response).toBe('confirmed')
  })

  it('records no; 404 for an unknown or malformed token; 410 for an expired one', async () => {
    const { w, token } = await asked()
    expect((await post(token, { answer: 'no' })).status).toBe(200)
    expect(w.response).toBe('denied')

    expect((await get('nope')).status).toBe(404)
    expect((await get('A'.repeat(43))).status).toBe(404)

    const { w: w2, token: t2 } = await asked()
    w2.token_expires_at = '2020-01-01T00:00:00Z'
    const res = await get(t2)
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ ok: false, reason: 'expired' })
    expect((await post(t2, { answer: 'yes' })).status).toBe(410)
    expect(w2.response).toBeUndefined()
  })

  it('rejects a bad body and rate limits by ip', async () => {
    const { token } = await asked()
    expect((await post(token, { answer: 'maybe' })).status).toBe(400)
    const statuses: number[] = []
    for (let i = 0; i < 61; i++) statuses.push((await get('x'.repeat(43), '9.9.9.9')).status)
    expect(statuses.slice(0, 60).every(s => s === 404)).toBe(true)
    expect(statuses[60]).toBe(429)
  })
})

describe('claim submission asks everyone', () => {
  it('names the claimant\'s witnesses, adds the course contacts, and emails them all once', async () => {
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    db.seed('course_contacts', { course_id: COURSE_ID, name: 'Club Manager', email: 'Manager@Club.Example' })
    const b = bet({ status: 'active', declared_at: null })
    db.putObject('verification-docs', `${USER_A.id}/${b.id}/certificate/c.pdf`, 'x')
    const submit = (body: unknown) => submitClaim(jsonRequest('http://x', body) as never, { params: Promise.resolve({ betId: b.id as string }) })

    const res = await submit({ certificatePath: `${USER_A.id}/${b.id}/certificate/c.pdf`, witnesses: [{ role: 'witness', name: 'Sipho Dlamini', email: 'sipho@example.com' }] })
    expect(res.status).toBe(200)
    const rows = db.rows('claim_witnesses')
    expect(rows.map(r => [r.email, r.role, r.source])).toEqual([
      ['sipho@example.com', 'witness', 'claimant'],
      ['manager@club.example', 'club_official', 'course'],
    ])
    expect(sentTo().map(m => m.to).sort()).toEqual(['manager@club.example', 'sipho@example.com'])

    // Resubmitting with the same witness sends nothing new; adding one sends one more.
    await submit({ certificatePath: `${USER_A.id}/${b.id}/certificate/c.pdf`, witnesses: [{ role: 'witness', name: 'Sipho Dlamini', email: 'sipho@example.com' }, { role: 'witness', name: 'Thandi Nkosi', email: 't@example.com' }] })
    expect(sentTo().map(m => m.to).sort()).toEqual(['manager@club.example', 'sipho@example.com', 't@example.com'])
    expect(db.rows('claim_witnesses')).toHaveLength(3)
  })
})

describe('replaceWitnesses keeps answers', () => {
  it('keeps rows still on the list (with their responses), drops the rest, never touches course rows', async () => {
    const b = bet()
    const [v] = db.seed('verifications', { bet_id: b.id, status: 'documents_received' })
    const [keep, drop, club] = db.seed('claim_witnesses',
      { bet_id: b.id, verification_id: v.id, role: 'witness', name: 'Keep Me', email: 'keep@example.com', source: 'claimant', response: 'confirmed' },
      { bet_id: b.id, verification_id: v.id, role: 'witness', name: 'Drop', email: 'drop@example.com', source: 'claimant' },
      { bet_id: b.id, verification_id: v.id, role: 'club_official', name: 'Club', email: 'club@example.com', source: 'course' },
    )
    await replaceWitnesses(admin(), b.id as string, v.id as string, [
      { role: 'witness', name: 'Keep Me Renamed', email: 'keep@example.com' },
      { role: 'witness', name: 'New', email: 'new@example.com' },
    ])
    const rows = db.rows('claim_witnesses')
    expect(rows.map(r => r.email).sort()).toEqual(['club@example.com', 'keep@example.com', 'new@example.com'])
    expect(keep).toMatchObject({ name: 'Keep Me Renamed', response: 'confirmed' })
    expect(rows).toContain(club)
    expect(rows).not.toContain(drop)
  })
})

describe('admin', () => {
  it('detail shows each person\'s status; resend issues a new link', async () => {
    const b = bet()
    const [v] = db.seed('verifications', { bet_id: b.id, status: 'documents_received' })
    const [w] = db.seed('claim_witnesses', { bet_id: b.id, verification_id: v.id, role: 'witness', name: 'Sipho', email: 's@example.com', source: 'claimant', requested_at: '2026-09-13T00:00:00Z', request_count: 1, token_expires_at: '2020-01-01T00:00:00Z' })
    db.seed('claim_witnesses', { bet_id: b.id, verification_id: v.id, role: 'club_official', name: 'Club', email: 'c@example.com', source: 'course', response: 'denied', responded_at: '2026-09-14T00:00:00Z', response_note: 'No such certificate' })
    const detail = await (await adminDetail(new Request('http://x') as never, vp(v.id as string))).json()
    expect(detail.witnesses).toMatchObject([
      { name: 'Sipho', source: 'claimant', requestCount: 1, response: null, linkExpired: true },
      { name: 'Club', source: 'course', response: 'denied', responseNote: 'No such certificate', linkExpired: false },
    ])
    const res = await resendRequests(jsonRequest('http://x', { witnessId: w.id }) as never, vp(v.id as string))
    expect(await res.json()).toMatchObject({ success: true, sent: 1, failed: 0 })
    expect(w.request_count).toBe(2)
    expect(sentTo().map(m => m.to)).toEqual(['s@example.com'])
  })

  it('evidence pack carries the claim, hashes, witnesses, flags, events and payments, and its own sha256', async () => {
    const b = bet({ video_url: `${USER_A.id}/x/shot.mp4`, video_sha256: 'vhash', risk_score: 3, risk_flags: [{ rule: 'no_location', severity: 'low', detail: {} }], payout_reference: 'FNB-1' })
    const [v] = db.seed('verifications', { bet_id: b.id, status: 'approved', certificate_path: `${USER_A.id}/x/c.pdf`, certificate_sha256: 'chash', review_checklist: { batch: false } })
    db.seed('claim_witnesses', { bet_id: b.id, role: 'witness', name: 'Sipho', email: 's@example.com', source: 'claimant', response: 'confirmed' })
    db.seed('claim_events', { bet_id: b.id, table_name: 'bets', action: 'insert', actor_role: 'service_role', after: {} })
    db.seed('payfast_payments', { bet_id: b.id, m_payment_id: 'gl_1', amount_cents: 5000, status: 'complete' })

    const res = await evidencePack(new Request('http://x') as never, vp(v.id as string))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="evidence-${b.id}.json"`)
    const body = await res.text()
    expect(res.headers.get('x-evidence-sha256')).toBe(createHash('sha256').update(body).digest('hex'))
    const pack = JSON.parse(body)
    expect(pack.format).toBe('get-lucky-evidence-pack/1')
    expect(pack.claimant).toMatchObject({ name: 'Alice Ace', email: USER_A.email })
    expect(pack.objects.footage).toMatchObject({ sha256: 'vhash', url: `https://storage.example/signed/${USER_A.id}/x/shot.mp4` })
    expect(pack.objects.certificate.sha256).toBe('chash')
    expect(pack.risk).toMatchObject({ score: 3 })
    expect(pack.witnesses).toMatchObject([{ name: 'Sipho', response: 'confirmed' }])
    expect(pack.review).toMatchObject({ payoutReference: 'FNB-1', checklist: { batch: false } })
    expect(pack.events).toHaveLength(1)
    expect(pack.payments).toMatchObject([{ m_payment_id: 'gl_1' }])
  })

  it('course contacts: add (lowercased, no duplicates), remove', async () => {
    const cp = { params: Promise.resolve({ courseId: COURSE_ID }) }
    const add = (body: unknown) => addContact(jsonRequest('http://x', body) as never, cp)
    const ok = await add({ name: 'Club Manager', email: ' Manager@Club.Example ' })
    expect(ok.status).toBe(200)
    const { contact } = await ok.json()
    expect(contact).toMatchObject({ name: 'Club Manager', email: 'manager@club.example' })
    expect((await add({ name: 'Again', email: 'manager@club.example' })).status).toBe(409)
    expect((await add({ name: 'X', email: 'not-an-email' })).status).toBe(400)
    expect((await removeContact(new Request(`http://x/api?id=${contact.id}`, { method: 'DELETE' }) as never, cp)).status).toBe(200)
    expect(db.rows('course_contacts')).toHaveLength(0)
    expect((await removeContact(new Request(`http://x/api?id=${contact.id}`, { method: 'DELETE' }) as never, cp)).status).toBe(404)
  })
})
