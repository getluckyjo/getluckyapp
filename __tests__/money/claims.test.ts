/**
 * The result and claim path: declaring a miss or a win, submitting evidence,
 * getting an upload slot for the footage and sealing it afterwards.
 *
 *   PATCH /api/bets/[betId]
 *   POST  /api/verifications/[betId]
 *   GET   /api/verifications/[betId]
 *   POST  /api/videos/upload-url
 *   POST  /api/videos/uploaded
 *
 * Every write is scoped to the caller's own bet, goes through the state
 * machine in src/lib/claims/state-machine.ts, and is applied with the
 * service role after an ownership check through RLS.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID, type FakeClientOptions } from '../helpers/fake-supabase'
import { PATCH as patchBet, GET as getBet } from '@/app/api/bets/[betId]/route'
import { POST as submitClaim, GET as getVerification } from '@/app/api/verifications/[betId]/route'
import { POST as uploadUrl } from '@/app/api/videos/upload-url/route'
import { POST as sealVideo } from '@/app/api/videos/uploaded/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb
const IN_WINDOW = new Date(Date.now() + 6 * 3_600_000).toISOString()
const PAST = new Date(Date.now() - 60_000).toISOString()

const asUser = (user = USER_A, opts: FakeClientOptions = {}) =>
  serverClient.createClient.mockResolvedValue(createFakeClient(db, { user, ...opts }))
const params = (betId: string) => ({ params: Promise.resolve({ betId }) })
const ownBet = (over: Record<string, unknown> = {}) =>
  db.seed('bets', { user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'active', expires_at: IN_WINDOW, ...over })[0]
const suspendA = () => db.seed('profiles', { id: USER_A.id, suspended_at: '2026-09-01T00:00:00Z' })

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://staging.supabase.co')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

const declare = (betId: string, body: unknown) =>
  patchBet(jsonRequest('http://x', body, { method: 'PATCH' }) as never, params(betId))

describe('PATCH /api/bets/[betId] — declaring a result', () => {
  it('401 without a session', async () => {
    asUser(null as never)
    expect((await declare('any', { status: 'miss' })).status).toBe(401)
  })

  it('declares a miss with a server-side timestamp and actor', async () => {
    asUser()
    const bet = ownBet()
    const before = Date.now()
    const res = await declare(bet.id as string, { status: 'miss' })
    expect(res.status).toBe(200)
    expect(bet).toMatchObject({ status: 'miss', declared_result: 'miss', updated_by: USER_A.id })
    expect(Date.parse(bet.declared_at as string)).toBeGreaterThanOrEqual(before - 1000)
  })

  it('derives declared_result server-side and ignores what the client sends', async () => {
    asUser()
    const bet = ownBet()
    await declare(bet.id as string, { status: 'miss', declared_result: 'win' })
    expect(bet.declared_result).toBe('miss')
  })

  it('only allows the player to move a bet to miss or claimed, never verified or paid', async () => {
    asUser()
    const bet = ownBet()
    for (const status of ['verified', 'paid', 'active', 'anything', undefined]) {
      const res = await declare(bet.id as string, { status })
      expect(res.status, String(status)).toBe(400)
    }
    expect(bet.status).toBe('active')
  })

  it('is idempotent: repeating the same declaration is a 200 no-op', async () => {
    asUser()
    const bet = ownBet()
    await declare(bet.id as string, { status: 'miss' })
    const at = bet.declared_at
    const res = await declare(bet.id as string, { status: 'miss' })
    expect(res.status).toBe(200)
    expect((await res.json()).alreadyDone).toBe(true)
    expect(bet.declared_at).toBe(at)
  })

  it('404 for another user\'s bet, nothing written', async () => {
    asUser(USER_B)
    const bet = ownBet()
    const res = await declare(bet.id as string, { status: 'claimed' })
    expect(res.status).toBe(404)
    expect(bet.status).toBe('active')
  })

  it('409 INVALID_TRANSITION: a declared miss cannot become a claim', async () => {
    asUser()
    const bet = ownBet({ status: 'miss', declared_result: 'miss', declared_at: '2026-01-01T00:00:00Z' })
    const res = await declare(bet.id as string, { status: 'claimed' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('INVALID_TRANSITION')
    expect(bet.status).toBe('miss')
  })

  it.each(['claimed', 'verified', 'paid'])('409: a %s bet cannot be changed by the player', async (status) => {
    asUser()
    const bet = ownBet({ status, declared_result: 'win' })
    const res = await declare(bet.id as string, { status: 'miss' })
    expect(res.status).toBe(409)
    expect(bet.status).toBe(status)
  })

  it('410 BET_EXPIRED once the play window has closed', async () => {
    asUser()
    const bet = ownBet({ expires_at: PAST })
    const res = await declare(bet.id as string, { status: 'miss' })
    expect(res.status).toBe(410)
    expect((await res.json()).code).toBe('BET_EXPIRED')
    expect(bet.status).toBe('active')
  })

  it('403 ACCOUNT_SUSPENDED for a suspended player', async () => {
    asUser()
    suspendA()
    const bet = ownBet()
    const res = await declare(bet.id as string, { status: 'claimed' })
    expect(res.status).toBe(403)
    expect(bet.status).toBe('active')
  })

  it('409 CONFLICT when the bet changed between the read and the write', async () => {
    const bet = ownBet()
    const client = createFakeClient(db, { user: USER_A })
    const originalFrom = client.from.bind(client)
    client.from = ((table: string) => {
      const b = originalFrom(table)
      if (table === 'bets') {
        const origMaybe = b.maybeSingle.bind(b)
        b.maybeSingle = () => { const r = origMaybe(); bet.status = 'miss'; return r }
      }
      return b
    }) as typeof client.from
    serverClient.createClient.mockResolvedValue(client)
    const res = await declare(bet.id as string, { status: 'claimed' })
    expect(res.status).toBe(409)
    expect(bet.status).toBe('miss')
  })
})

describe('GET /api/bets/[betId]', () => {
  it('returns only the caller\'s own bet', async () => {
    const bet = ownBet()
    asUser()
    const mine = await (await getBet(new Request('http://x') as never, params(bet.id as string))).json()
    expect(mine.bet.id).toBe(bet.id)

    asUser(USER_B)
    const theirs = await (await getBet(new Request('http://x') as never, params(bet.id as string))).json()
    expect(theirs.bet).toBeNull()
  })
})

describe('POST /api/verifications/[betId] — submitting a claim', () => {
  const submit = (betId: string, body: unknown = {}) =>
    submitClaim(jsonRequest('http://x', body) as never, params(betId))
  // The browser uploads straight to storage before submitting; the server
  // reads each document back to hash it, so the objects must exist.
  const cert = (bet: Record<string, unknown>) => { const p = `${USER_A.id}/${bet.id}/certificate/1-cert.pdf`; db.putObject('verification-docs', p, 'cert bytes'); return p }
  const aff = (bet: Record<string, unknown>) => { const p = `${USER_A.id}/${bet.id}/affidavit/2-aff.pdf`; db.putObject('verification-docs', p, 'aff bytes'); return p }
  const PARTNER = [{ role: 'witness', name: 'Sipho Dlamini', email: 'sipho@example.com' }]

  it('401 without a session', async () => {
    asUser(null as never)
    expect((await submit('any')).status).toBe(401)
  })

  it('moves an active bet to claimed/win and opens a documents_received verification', async () => {
    asUser()
    const bet = ownBet()
    const res = await submit(bet.id as string, { witnesses: PARTNER, certificatePath: cert(bet), affidavitPath: aff(bet) })
    expect(res.status).toBe(200)
    expect(bet).toMatchObject({ status: 'claimed', declared_result: 'win', updated_by: USER_A.id })
    expect(typeof bet.declared_at).toBe('string')

    const [v] = db.rows('verifications')
    expect(v).toMatchObject({ bet_id: bet.id, status: 'documents_received', certificate_path: cert(bet), affidavit_path: aff(bet), updated_by: USER_A.id })
  })

  it('a second submit before review updates the same verification and keeps the original declared_at', async () => {
    asUser()
    const bet = ownBet()
    await submit(bet.id as string, { witnesses: PARTNER, certificatePath: cert(bet) })
    const declaredAt = bet.declared_at
    await submit(bet.id as string, { witnesses: PARTNER, affidavitPath: aff(bet) })
    expect(db.rows('verifications')).toHaveLength(1)
    expect(db.rows('verifications')[0]).toMatchObject({ certificate_path: cert(bet), affidavit_path: aff(bet) })
    expect(bet.declared_at).toBe(declaredAt)
  })

  it('404 for another user\'s bet, nothing written', async () => {
    asUser(USER_B)
    const bet = ownBet()
    const res = await submit(bet.id as string)
    expect(res.status).toBe(404)
    expect(bet.status).toBe('active')
    expect(db.rows('verifications')).toHaveLength(0)
  })

  it.each(['rejected', 'approved', 'under_review'])('409 CLAIM_LOCKED: cannot resubmit a claim that is %s', async (status) => {
    asUser()
    const bet = ownBet({ status: 'claimed', declared_result: 'win', declared_at: '2026-01-01T00:00:00Z' })
    const [v] = db.seed('verifications', { bet_id: bet.id, status, reviewer_notes: 'Footage inconclusive' })
    const res = await submit(bet.id as string)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('CLAIM_LOCKED')
    expect(v.status).toBe(status)
    expect(bet.declared_at).toBe('2026-01-01T00:00:00Z')
  })

  it.each(['miss', 'verified', 'paid'])('409 INVALID_TRANSITION: a %s bet cannot be claimed', async (status) => {
    asUser()
    const bet = ownBet({ status, declared_result: status === 'miss' ? 'miss' : 'win' })
    const res = await submit(bet.id as string)
    expect(res.status).toBe(409)
    expect(bet.status).toBe(status)
    expect(db.rows('verifications')).toHaveLength(0)
  })

  it('410 BET_EXPIRED: an active bet past its window cannot be claimed', async () => {
    asUser()
    const bet = ownBet({ expires_at: PAST })
    const res = await submit(bet.id as string, { witnesses: PARTNER, certificatePath: cert(bet) })
    expect(res.status).toBe(410)
    expect(bet.status).toBe('active')
    expect(db.rows('verifications')).toHaveLength(0)
  })

  it('403 ACCOUNT_SUSPENDED', async () => {
    asUser()
    suspendA()
    const bet = ownBet()
    expect((await submit(bet.id as string)).status).toBe(403)
    expect(bet.status).toBe('active')
  })

  it('400 for evidence paths outside the caller\'s own folder for this bet', async () => {
    asUser()
    const bet = ownBet()
    const bad = [
      'someone-elses-bet/certificate/cert.pdf',
      `${USER_B.id}/${bet.id}/certificate/cert.pdf`,
      `${USER_A.id}/other-bet/certificate/cert.pdf`,
      `${USER_A.id}/${bet.id}/../${USER_B.id}/x.pdf`,
      42,
    ]
    for (const certificatePath of bad) {
      const res = await submit(bet.id as string, { witnesses: PARTNER, certificatePath })
      expect(res.status, String(certificatePath)).toBe(400)
    }
    expect(bet.status).toBe('active')
    expect(db.rows('verifications')).toHaveLength(0)
  })
})

describe('GET /api/verifications/[betId]', () => {
  it('returns the verification only for the owner (IDOR check)', async () => {
    const bet = ownBet({ status: 'claimed' })
    db.seed('verifications', { bet_id: bet.id, status: 'under_review' })

    asUser()
    const mine = await (await getVerification(new Request('http://x') as never, params(bet.id as string))).json()
    expect(mine.verification.status).toBe('under_review')

    asUser(USER_B)
    const theirs = await (await getVerification(new Request('http://x') as never, params(bet.id as string))).json()
    expect(theirs.verification).toBeNull()
  })
})

describe('POST /api/videos/upload-url — footage slot', () => {
  it('issues a slot under the caller\'s folder and records the server-chosen path on the bet', async () => {
    asUser()
    const bet = ownBet()
    const res = await uploadUrl(jsonRequest('http://x', { betId: bet.id, mimeType: 'video/mp4', storagePath: 'ignored/by/server' }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.storagePath).toBe(`${USER_A.id}/${bet.id}/shot.mp4`)
    expect(body.signedUrl).toContain(body.storagePath)
    expect(bet.video_url).toBe(body.storagePath)
    expect(bet.updated_by).toBe(USER_A.id)
  })

  it('403 for a bet the caller does not own', async () => {
    asUser(USER_B)
    const bet = ownBet()
    expect((await uploadUrl(jsonRequest('http://x', { betId: bet.id }) as never)).status).toBe(403)
    expect(bet.video_url).toBeUndefined()
  })

  it('409 once the bet is resolved and 410 once the window has closed', async () => {
    asUser()
    const resolved = ownBet({ status: 'miss' })
    expect((await uploadUrl(jsonRequest('http://x', { betId: resolved.id }) as never)).status).toBe(409)
    const expired = ownBet({ expires_at: PAST })
    expect((await uploadUrl(jsonRequest('http://x', { betId: expired.id }) as never)).status).toBe(410)
  })

  it('400 without a betId and 401 without a session', async () => {
    asUser()
    expect((await uploadUrl(jsonRequest('http://x', {}) as never)).status).toBe(400)
    asUser(null as never)
    expect((await uploadUrl(jsonRequest('http://x', { betId: 'x' }) as never)).status).toBe(401)
  })
})

describe('POST /api/videos/uploaded — sealing the footage', () => {
  const FOOTAGE = 'not really a video but the bytes are what count'
  const seal = (betId: string) => sealVideo(jsonRequest('http://x', { betId }) as never)

  it('hashes what is in storage and records size, hash and a server timestamp', async () => {
    const bet = ownBet({ video_url: `${USER_A.id}/x/shot.webm` })
    asUser()
    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db, { storageObjects: { [`${USER_A.id}/x/shot.webm`]: FOOTAGE } }))
    const before = Date.now()
    const res = await seal(bet.id as string)
    expect(res.status).toBe(200)
    const expected = createHash('sha256').update(FOOTAGE).digest('hex')
    expect((await res.json()).sha256).toBe(expected)
    expect(bet).toMatchObject({ video_sha256: expected, video_bytes: FOOTAGE.length, updated_by: USER_A.id })
    expect(Date.parse(bet.video_uploaded_at as string)).toBeGreaterThanOrEqual(before - 1000)
  })

  it('is write-once: a second call never re-hashes or overwrites', async () => {
    const bet = ownBet({ video_url: `${USER_A.id}/x/shot.webm`, video_sha256: 'original-hash' })
    asUser()
    adminClient.createAdminClient.mockImplementation(() => createFakeClient(db, { storageObjects: { [`${USER_A.id}/x/shot.webm`]: 'tampered bytes' } }))
    const res = await seal(bet.id as string)
    expect((await res.json()).alreadyRecorded).toBe(true)
    expect(bet.video_sha256).toBe('original-hash')
  })

  it('404 when nothing landed in storage, 400 when no slot was issued, 404 for others\' bets', async () => {
    asUser()
    const noObject = ownBet({ video_url: `${USER_A.id}/missing/shot.webm` })
    expect((await seal(noObject.id as string)).status).toBe(404)
    const noSlot = ownBet()
    expect((await seal(noSlot.id as string)).status).toBe(400)
    asUser(USER_B)
    expect((await seal(noObject.id as string)).status).toBe(404)
  })
})
