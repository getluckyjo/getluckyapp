/**
 * The result and claim path: declaring a miss or a win, submitting evidence,
 * and getting a signed upload slot for the footage.
 *
 *   PATCH /api/bets/[betId]
 *   POST  /api/verifications/[betId]
 *   GET   /api/verifications/[betId]
 *   POST  /api/videos/upload-url
 *
 * Every write must be scoped to the caller's own bet. Known state-machine gaps
 * (AUDIT.md B.4) are pinned as `it.fails` so Batch 2 flips them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'
import { PATCH as patchBet, GET as getBet } from '@/app/api/bets/[betId]/route'
import { POST as submitClaim, GET as getVerification } from '@/app/api/verifications/[betId]/route'
import { POST as uploadUrl } from '@/app/api/videos/upload-url/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)

let db: FakeDb
const asUser = (user = USER_A) => serverClient.createClient.mockResolvedValue(createFakeClient(db, { user }))
const params = (betId: string) => ({ params: Promise.resolve({ betId }) })
const ownBet = (over: Record<string, unknown> = {}) =>
  db.seed('bets', { user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'active', ...over })[0]

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://staging.supabase.co')
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('PATCH /api/bets/[betId]', () => {
  it('401 without a session', async () => {
    asUser(null as never)
    const res = await patchBet(jsonRequest('http://x', { status: 'miss' }, { method: 'PATCH' }) as never, params('any'))
    expect(res.status).toBe(401)
  })

  it('declares a miss with a server-side timestamp', async () => {
    asUser()
    const bet = ownBet()
    const before = Date.now()
    const res = await patchBet(jsonRequest('http://x', { status: 'miss', declared_result: 'miss' }, { method: 'PATCH' }) as never, params(bet.id as string))
    expect(res.status).toBe(200)
    expect(bet.status).toBe('miss')
    expect(bet.declared_result).toBe('miss')
    expect(Date.parse(bet.declared_at as string)).toBeGreaterThanOrEqual(before - 1000)
  })

  it('only allows the player to move a bet to miss or claimed, never verified or paid', async () => {
    asUser()
    const bet = ownBet()
    for (const status of ['verified', 'paid', 'active', 'anything']) {
      const res = await patchBet(jsonRequest('http://x', { status }, { method: 'PATCH' }) as never, params(bet.id as string))
      expect(res.status, status).toBe(400)
    }
    expect(bet.status).toBe('active')
  })

  it('rejects an invalid declared_result', async () => {
    asUser()
    const bet = ownBet()
    const res = await patchBet(jsonRequest('http://x', { declared_result: 'hole_in_one' }, { method: 'PATCH' }) as never, params(bet.id as string))
    expect(res.status).toBe(400)
  })

  it('cannot touch another user\'s bet', async () => {
    asUser(USER_B)
    const bet = ownBet()
    await patchBet(jsonRequest('http://x', { status: 'claimed', declared_result: 'win' }, { method: 'PATCH' }) as never, params(bet.id as string))
    expect(bet.status).toBe('active')
    expect(bet.declared_result).toBeUndefined()
  })

  it.fails('refuses to turn a declared miss into a claim (Batch 2 state machine)', async () => {
    asUser()
    const bet = ownBet({ status: 'miss', declared_result: 'miss', declared_at: '2026-01-01T00:00:00Z' })
    const res = await patchBet(jsonRequest('http://x', { status: 'claimed', declared_result: 'win' }, { method: 'PATCH' }) as never, params(bet.id as string))
    expect(res.status).toBe(409)
    expect(bet.status).toBe('miss')
  })

  it.fails('refuses to change a verified bet (Batch 2 state machine)', async () => {
    asUser()
    const bet = ownBet({ status: 'verified', declared_result: 'win' })
    const res = await patchBet(jsonRequest('http://x', { status: 'miss' }, { method: 'PATCH' }) as never, params(bet.id as string))
    expect(res.status).toBe(409)
    expect(bet.status).toBe('verified')
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

describe('POST /api/verifications/[betId]', () => {
  const submit = (betId: string, body: unknown = {}) =>
    submitClaim(jsonRequest('http://x', body) as never, params(betId))

  it('401 without a session', async () => {
    asUser(null as never)
    expect((await submit('any')).status).toBe(401)
  })

  it('marks the bet claimed/win and opens a documents_received verification', async () => {
    asUser()
    const bet = ownBet()
    const res = await submit(bet.id as string, { certificatePath: `${bet.id}/certificate/cert.pdf`, affidavitPath: `${bet.id}/affidavit/aff.pdf` })
    expect(res.status).toBe(200)
    expect(bet).toMatchObject({ status: 'claimed', declared_result: 'win' })
    expect(typeof bet.declared_at).toBe('string')

    const [v] = db.rows('verifications')
    expect(v).toMatchObject({
      bet_id: bet.id,
      status: 'documents_received',
      certificate_path: `${bet.id}/certificate/cert.pdf`,
      affidavit_path: `${bet.id}/affidavit/aff.pdf`,
    })
  })

  it('does not change another user\'s bet', async () => {
    asUser(USER_B)
    const bet = ownBet()
    await submit(bet.id as string)
    expect(bet.status).toBe('active')
  })

  it.fails('refuses to reopen a rejected claim (Batch 2)', async () => {
    asUser()
    const bet = ownBet({ status: 'claimed', declared_result: 'win' })
    const [v] = db.seed('verifications', { bet_id: bet.id, status: 'rejected', reviewer_notes: 'Footage inconclusive' })
    const res = await submit(bet.id as string)
    expect(res.status).toBe(409)
    expect(v.status).toBe('rejected')
  })

  it.fails('refuses evidence paths outside the caller\'s own folder (Batch 1/2)', async () => {
    asUser()
    const bet = ownBet()
    const res = await submit(bet.id as string, { certificatePath: 'someone-elses-bet/certificate/cert.pdf' })
    expect(res.status).toBe(400)
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

describe('POST /api/videos/upload-url', () => {
  it('issues an upload slot under the caller\'s own folder for their own bet', async () => {
    asUser()
    const bet = ownBet()
    const res = await uploadUrl(jsonRequest('http://x', { betId: bet.id, mimeType: 'video/mp4' }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.storagePath).toBe(`${USER_A.id}/${bet.id}/shot.mp4`)
    expect(body.signedUrl).toContain(body.storagePath)
  })

  it('403 for a bet the caller does not own', async () => {
    asUser(USER_B)
    const bet = ownBet()
    const res = await uploadUrl(jsonRequest('http://x', { betId: bet.id }) as never)
    expect(res.status).toBe(403)
  })

  it('400 without a betId and 401 without a session', async () => {
    asUser()
    expect((await uploadUrl(jsonRequest('http://x', {}) as never)).status).toBe(400)
    asUser(null as never)
    expect((await uploadUrl(jsonRequest('http://x', { betId: 'x' }) as never)).status).toBe(401)
  })
})
