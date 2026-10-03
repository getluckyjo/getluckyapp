/**
 * The phone's side of the footage upload (src/lib/claims/upload-footage.ts):
 * slot, PUT, seal, and the retry after a miss has been declared.
 *
 * At the SaSwazi Golf Trek (2 October 2026) one of four players declared a
 * miss four seconds after the upload slot was issued, left the Miss screen,
 * and the upload never finished. Once the miss is declared the server issues
 * no new slot, so a retry has to reuse the first one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { FakeDb, createFakeClient, jsonRequest, USER_A, COURSE_ID, HOLE_ID } from '../helpers/fake-supabase'
import { uploadFootage, alreadyStored, type FootageDeps, type FootageJob, type PutResult } from '@/lib/claims/upload-footage'
import { POST as uploadUrl } from '@/app/api/videos/upload-url/route'
import { POST as sealVideo } from '@/app/api/videos/uploaded/route'
import { PATCH as patchBet } from '@/app/api/bets/[betId]/route'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb
const IN_WINDOW = new Date(Date.now() + 6 * 3_600_000).toISOString()
const NOW = Date.now()
const CAPTURE = { startedAt: new Date(NOW - 50_000).toISOString(), endedAt: new Date(NOW - 7_000).toISOString(), durationMs: 43_000, lat: -30.395, lng: 30.665, accuracyM: 9 }
const FOOTAGE = 'forty-three seconds of a swing at Umdoni 16'

const ownBet = (over: Record<string, unknown> = {}) =>
  db.seed('bets', { user_id: USER_A.id, course_id: COURSE_ID, hole_id: HOLE_ID, tier: 'tier_1', status: 'active', expires_at: IN_WINDOW, ...over })[0]
const job = (betId: string, over: Partial<FootageJob> = {}): FootageJob =>
  ({ betId, blob: new Blob([FOOTAGE]), mimeType: 'video/webm', capture: CAPTURE, ...over })
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
  db.seed('courses', { id: COURSE_ID, name: 'Umdoni Park', lat: -30.40, lng: 30.66 })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('uploadFootage — through the real routes', () => {
  /** fetch() as the phone sees it, answered by the route handlers. */
  const routes: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    if (input === '/api/videos/upload-url') return uploadUrl(jsonRequest('http://x', body) as never)
    if (input === '/api/videos/uploaded') return sealVideo(jsonRequest('http://x', body) as never)
    throw new Error(`unexpected fetch ${String(input)}`)
  }
  /** A PUT that lands the bytes at the slot's path, or fails like a phone that lost signal. */
  const storagePut = (fail: boolean) => async (url: string, blob: Blob): Promise<PutResult> => {
    if (fail) throw new Error('Network error')
    db.putObject('shot-videos', url.replace('https://storage.example/upload/', ''), await blob.text())
    return { status: 200, body: '' }
  }

  it('slot, PUT, seal: the bet carries the hash of what landed and the recorder report', async () => {
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const bet = ownBet()
    const deps: FootageDeps = { fetch: routes, put: storagePut(false), slots: new Map() }

    await uploadFootage(job(bet.id as string), deps, () => {})

    expect(bet.video_sha256).toBe(createHash('sha256').update(FOOTAGE).digest('hex'))
    expect(bet).toMatchObject({ video_url: `${USER_A.id}/${bet.id}/shot.webm`, capture_duration_ms: 43_000, capture_accuracy_m: 9 })
  })

  it('a miss declared while the upload is failing still gets its footage sealed', async () => {
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const bet = ownBet()
    const betId = bet.id as string
    const slots = new Map<string, string>()

    // The upload starts as the recording ends, and dies.
    await expect(uploadFootage(job(betId), { fetch: routes, put: storagePut(true), slots }, () => {})).rejects.toThrow('Network error')
    expect(slots.get(betId)).toBe(`https://storage.example/upload/${USER_A.id}/${betId}/shot.webm`)

    // The Miss screen declares the miss; from here the server issues no slot.
    const declared = await patchBet(jsonRequest('http://x', { status: 'miss' }, { method: 'PATCH' }) as never, { params: Promise.resolve({ betId }) })
    expect(declared.status).toBe(200)
    expect((await uploadUrl(jsonRequest('http://x', { betId }) as never)).status).toBe(409)

    // Back in front: the retry reuses the slot it was given and seals.
    await uploadFootage(job(betId), { fetch: routes, put: storagePut(false), slots }, () => {})

    expect(bet).toMatchObject({ status: 'miss', capture_duration_ms: 43_000, capture_accuracy_m: 9 })
    expect(bet.video_sha256).toBe(createHash('sha256').update(FOOTAGE).digest('hex'))
  })
})

describe('uploadFootage — the rules', () => {
  const okSlot = () => json(200, { signedUrl: 'https://storage.example/upload/fresh' })

  function stubs({ slot = okSlot, put = { status: 200, body: '' } as PutResult, seal = () => json(200, { ok: true }) } = {}) {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) })
      return String(input) === '/api/videos/upload-url' ? slot() : seal()
    })
    const putStub = vi.fn(async () => put)
    return { calls, fetchStub, putStub, deps: (slots = new Map<string, string>()): FootageDeps => ({ fetch: fetchStub as never, put: putStub, slots }) }
  }

  it('sends the recorder report with every slot request, so a retry never blanks it', async () => {
    const s = stubs()
    await uploadFootage(job('bet-1'), s.deps(), () => {})
    await uploadFootage(job('bet-1'), s.deps(), () => {})
    const slotCalls = s.calls.filter(c => c.url === '/api/videos/upload-url')
    expect(slotCalls).toHaveLength(2)
    for (const c of slotCalls) expect(c.body).toMatchObject({ betId: 'bet-1', capture: CAPTURE })
  })

  it('reuses the slot it holds when the server refuses or the phone is offline', async () => {
    for (const slot of [() => json(409, { error: 'This bet is already miss.' }), () => { throw new TypeError('Failed to fetch') }]) {
      const s = stubs({ slot })
      await uploadFootage(job('bet-1'), s.deps(new Map([['bet-1', 'https://storage.example/upload/first']])), () => {})
      expect(s.putStub).toHaveBeenCalledWith('https://storage.example/upload/first', expect.any(Blob), 'video/webm', expect.any(Function))
    }
  })

  it('no slot from the server and none held: fails before any PUT', async () => {
    const s = stubs({ slot: () => json(409) })
    await expect(uploadFootage(job('bet-1'), s.deps(), () => {})).rejects.toThrow('No upload slot')
    expect(s.putStub).not.toHaveBeenCalled()
  })

  it('footage already at the path (the PUT landed, the seal did not): seals it', async () => {
    for (const put of [{ status: 409, body: '' }, { status: 400, body: '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}' }]) {
      const s = stubs({ put })
      await uploadFootage(job('bet-1'), s.deps(), () => {})
      expect(s.calls.at(-1)).toEqual({ url: '/api/videos/uploaded', body: { betId: 'bet-1' } })
    }
    expect(alreadyStored({ status: 400, body: 'Invalid signature' })).toBe(false)
  })

  it('a rejected PUT or a failed seal is a failed upload', async () => {
    const rejected = stubs({ put: { status: 403, body: 'Invalid signature' } })
    await expect(uploadFootage(job('bet-1'), rejected.deps(), () => {})).rejects.toThrow('Upload 403')
    expect(rejected.calls.some(c => c.url === '/api/videos/uploaded')).toBe(false)

    const unsealed = stubs({ seal: () => json(404, { error: 'Footage not found in storage' }) })
    await expect(uploadFootage(job('bet-1'), unsealed.deps(), () => {})).rejects.toThrow('Seal 404')
  })
})
