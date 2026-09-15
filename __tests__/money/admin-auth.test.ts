/**
 * requireAdmin() — the gate in front of every /api/admin/* handler — and one
 * real admin handler behind it (verification approval, which flips a bet to
 * `verified` and is therefore a money decision).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B } from '../helpers/fake-supabase'

const serverClient = vi.hoisted(() => ({ createClient: vi.fn() }))
const adminClient = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => serverClient)
vi.mock('@/lib/supabase/admin', () => adminClient)

let db: FakeDb

async function load(env: Record<string, string> = {}) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://staging.supabase.co')
  vi.stubEnv('NODE_ENV', 'production')
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  const [{ requireAdmin }, { PATCH }] = await Promise.all([
    import('@/lib/admin-auth'),
    import('@/app/api/admin/verifications/[verificationId]/route'),
  ])
  return { requireAdmin, PATCH }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  db = new FakeDb()
  serverClient.createClient.mockReset()
  adminClient.createAdminClient.mockReset()
  adminClient.createAdminClient.mockImplementation(() => createFakeClient(db))
})
afterEach(() => vi.restoreAllMocks())

describe('requireAdmin', () => {
  it('401 with no session', async () => {
    const { requireAdmin } = await load()
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: null }))
    const auth = await requireAdmin()
    expect(auth.error?.status).toBe(401)
    expect(auth.adminClient).toBeNull()
  })

  it('403 for a signed-in user whose profile is not admin', async () => {
    const { requireAdmin } = await load()
    db.seed('profiles', { id: USER_A.id, is_admin: false })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const auth = await requireAdmin()
    expect(auth.error?.status).toBe(403)
  })

  it('403 when the profile row is missing entirely', async () => {
    const { requireAdmin } = await load()
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    expect((await requireAdmin()).error?.status).toBe(403)
  })

  it('passes an admin through with a service-role client', async () => {
    const { requireAdmin } = await load()
    db.seed('profiles', { id: USER_A.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const auth = await requireAdmin()
    expect(auth.error).toBeNull()
    expect(auth.isMock).toBe(false)
    expect(auth.user?.id).toBe(USER_A.id)
    expect(auth.adminClient).not.toBeNull()
  })

  it('never falls back to the mock admin in production, even with ENABLE_MOCK_ADMIN set', async () => {
    const { requireAdmin } = await load({ ENABLE_MOCK_ADMIN: 'true' })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: null }))
    expect((await requireAdmin()).error?.status).toBe(401)

    serverClient.createClient.mockRejectedValue(new Error('supabase down'))
    const broken = await requireAdmin()
    expect(broken.isMock).toBe(false)
    expect(broken.error?.status).toBe(500)
  })
})

describe('PATCH /api/admin/verifications/[id]', () => {
  const params = (id: string) => ({ params: Promise.resolve({ verificationId: id }) })

  it('is refused for non-admins and changes nothing', async () => {
    const { PATCH } = await load()
    db.seed('profiles', { id: USER_B.id, is_admin: false })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_B }))
    const [bet] = db.seed('bets', { user_id: USER_B.id, status: 'claimed' })
    const [v] = db.seed('verifications', { bet_id: bet.id, status: 'documents_received' })

    const res = await PATCH(jsonRequest('http://x', { status: 'approved' }, { method: 'PATCH' }) as never, params(v.id as string))
    expect(res.status).toBe(403)
    expect(v.status).toBe('documents_received')
    expect(bet.status).toBe('claimed')
  })

  it('approval by an admin records who approved, when, and flips the bet to verified', async () => {
    const { PATCH } = await load()
    db.seed('profiles', { id: USER_A.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const [bet] = db.seed('bets', { user_id: USER_B.id, status: 'claimed' })
    const [v] = db.seed('verifications', { bet_id: bet.id, status: 'under_review' })

    const res = await PATCH(jsonRequest('http://x', { status: 'approved', reviewerNotes: 'Footage and certificate check out' }, { method: 'PATCH' }) as never, params(v.id as string))
    expect(res.status).toBe(200)
    expect(v).toMatchObject({ status: 'approved', reviewed_by: USER_A.id, reviewer_notes: 'Footage and certificate check out' })
    expect(typeof v.verified_at).toBe('string')
    expect(bet.status).toBe('verified')
  })

  it('rejection leaves the bet as claimed', async () => {
    const { PATCH } = await load()
    db.seed('profiles', { id: USER_A.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const [bet] = db.seed('bets', { user_id: USER_B.id, status: 'claimed' })
    const [v] = db.seed('verifications', { bet_id: bet.id, status: 'under_review' })

    await PATCH(jsonRequest('http://x', { status: 'rejected' }, { method: 'PATCH' }) as never, params(v.id as string))
    expect(v.status).toBe('rejected')
    expect(bet.status).toBe('claimed')
  })

  it('400 without a status or with an unknown one', async () => {
    const { PATCH } = await load()
    db.seed('profiles', { id: USER_A.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    expect((await PATCH(jsonRequest('http://x', {}, { method: 'PATCH' }) as never, params('v1'))).status).toBe(400)
    expect((await PATCH(jsonRequest('http://x', { status: 'paid' }, { method: 'PATCH' }) as never, params('v1'))).status).toBe(400)
  })

  it('409 on an illegal review transition: a decided claim cannot be reopened or flipped', async () => {
    const { PATCH } = await load()
    db.seed('profiles', { id: USER_A.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const [bet] = db.seed('bets', { user_id: USER_B.id, status: 'claimed' })
    const [rejected] = db.seed('verifications', { bet_id: bet.id, status: 'rejected' })
    for (const status of ['under_review', 'approved', 'documents_received']) {
      const res = await PATCH(jsonRequest('http://x', { status }, { method: 'PATCH' }) as never, params(rejected.id as string))
      expect(res.status, status).toBe(409)
      expect((await res.json()).code).toBe('INVALID_TRANSITION')
    }
    expect(rejected.status).toBe('rejected')
    expect(bet.status).toBe('claimed')
  })

  it('409 when approving a verification whose bet is no longer claimed', async () => {
    const { PATCH } = await load()
    db.seed('profiles', { id: USER_A.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const [bet] = db.seed('bets', { user_id: USER_B.id, status: 'miss' })
    const [v] = db.seed('verifications', { bet_id: bet.id, status: 'under_review' })
    const res = await PATCH(jsonRequest('http://x', { status: 'approved' }, { method: 'PATCH' }) as never, params(v.id as string))
    expect(res.status).toBe(409)
    expect(v.status).toBe('under_review')
    expect(bet.status).toBe('miss')
  })

  it('records the acting admin as updated_by on both rows (feeds the audit log)', async () => {
    const { PATCH } = await load()
    db.seed('profiles', { id: USER_A.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const [bet] = db.seed('bets', { user_id: USER_B.id, status: 'claimed' })
    const [v] = db.seed('verifications', { bet_id: bet.id, status: 'documents_received' })
    await PATCH(jsonRequest('http://x', { status: 'approved' }, { method: 'PATCH' }) as never, params(v.id as string))
    expect(v.updated_by).toBe(USER_A.id)
    expect(bet.updated_by).toBe(USER_A.id)
  })
})

describe('PATCH /api/admin/bets/[betId]', () => {
  const params = (id: string) => ({ params: Promise.resolve({ betId: id }) })
  async function loadBets() {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://staging.supabase.co')
    vi.stubEnv('NODE_ENV', 'production')
    return import('@/app/api/admin/bets/[betId]/route')
  }

  it('lets an admin confirm a payout: verified → paid', async () => {
    const { PATCH } = await loadBets()
    db.seed('profiles', { id: USER_A.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const [bet] = db.seed('bets', { user_id: USER_B.id, status: 'verified' })
    const res = await PATCH(jsonRequest('http://x', { status: 'paid' }, { method: 'PATCH' }) as never, params(bet.id as string))
    expect(res.status).toBe(200)
    expect(bet.status).toBe('paid')
    expect(bet.updated_by).toBe(USER_A.id)
  })

  it('refuses every other admin status change, including declaring results or approving directly', async () => {
    const { PATCH } = await loadBets()
    db.seed('profiles', { id: USER_A.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const cases: [string, string][] = [['claimed', 'verified'], ['claimed', 'paid'], ['active', 'miss'], ['miss', 'claimed'], ['paid', 'verified'], ['active', 'paid']]
    for (const [from, to] of cases) {
      const [bet] = db.seed('bets', { user_id: USER_B.id, status: from })
      const res = await PATCH(jsonRequest('http://x', { status: to }, { method: 'PATCH' }) as never, params(bet.id as string))
      expect(res.status, `${from} → ${to}`).toBe(409)
      expect(bet.status).toBe(from)
    }
    const [bet] = db.seed('bets', { user_id: USER_B.id, status: 'verified' })
    const res = await PATCH(jsonRequest('http://x', { declared_result: 'miss' }, { method: 'PATCH' }) as never, params(bet.id as string))
    expect(res.status).toBe(400)
  })
})
