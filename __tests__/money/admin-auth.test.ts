/**
 * requireAdmin() — the gate in front of every /api/admin/* handler — and one
 * real admin handler behind it (verification approval, which flips a bet to
 * `verified` and is therefore a money decision).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeDb, createFakeClient, jsonRequest, USER_A, USER_B, type FakeUser } from '../helpers/fake-supabase'
import { REVIEW_CHECKLIST } from '@/lib/claims/checklist'

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
    expect(auth.ok).toBe(false)
    if (!auth.ok) expect(auth.error.status).toBe(401)
  })

  it('403 for a signed-in user whose profile is not admin, or has no profile', async () => {
    const { requireAdmin } = await load()
    db.seed('profiles', { id: USER_A.id, is_admin: false })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const auth = await requireAdmin()
    expect(auth.ok).toBe(false)
    if (!auth.ok) expect(auth.error.status).toBe(403)

    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_B }))
    const noProfile = await requireAdmin()
    expect(noProfile.ok).toBe(false)
    if (!noProfile.ok) expect(noProfile.error.status).toBe(403)
  })

  it('passes an admin through with a service-role client', async () => {
    const { requireAdmin } = await load()
    db.seed('profiles', { id: USER_A.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const auth = await requireAdmin()
    expect(auth.ok).toBe(true)
    if (auth.ok) {
      expect(auth.user.id).toBe(USER_A.id)
      expect(auth.adminClient).toBeTruthy()
    }
  })

  it('has no development bypass: a broken auth check is a 500, never a mock admin', async () => {
    const { requireAdmin } = await load({ ENABLE_MOCK_ADMIN: 'true', NODE_ENV: 'development' })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: null }))
    const anon = await requireAdmin()
    expect(anon.ok).toBe(false)
    if (!anon.ok) expect(anon.error.status).toBe(401)

    vi.spyOn(console, 'error').mockImplementation(() => {})
    serverClient.createClient.mockRejectedValue(new Error('supabase down'))
    const broken = await requireAdmin()
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.error.status).toBe(500)
  })
})

describe('PATCH /api/admin/verifications/[id]', () => {
  const params = (id: string) => ({ params: Promise.resolve({ verificationId: id }) })
  const CHECKLIST = Object.fromEntries(REVIEW_CHECKLIST.map(i => [i.key, true]))
  const APPROVE = { status: 'approved', reviewerNotes: 'Footage and certificate check out; phoned the pro shop.', checklist: CHECKLIST }
  const REJECT = { status: 'rejected', reviewerNotes: 'Footage shows the ball stopping short of the hole.' }

  it('is refused for non-admins and changes nothing', async () => {
    const { PATCH } = await load()
    db.seed('profiles', { id: USER_B.id, is_admin: false })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_B }))
    const [bet] = db.seed('bets', { user_id: USER_B.id, status: 'claimed' })
    const [v] = db.seed('verifications', { bet_id: bet.id, status: 'documents_received' })

    const res = await PATCH(jsonRequest('http://x', APPROVE, { method: 'PATCH' }) as never, params(v.id as string))
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

    const res = await PATCH(jsonRequest('http://x', APPROVE, { method: 'PATCH' }) as never, params(v.id as string))
    expect(res.status).toBe(200)
    expect(v).toMatchObject({ status: 'approved', reviewed_by: USER_A.id, reviewer_notes: APPROVE.reviewerNotes })
    expect(typeof v.verified_at).toBe('string')
    expect(v.review_checklist).toMatchObject({ ...CHECKLIST, completed_by: USER_A.id })
    expect(bet.status).toBe('verified')
  })

  it('rejection leaves the bet as claimed', async () => {
    const { PATCH } = await load()
    db.seed('profiles', { id: USER_A.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const [bet] = db.seed('bets', { user_id: USER_B.id, status: 'claimed' })
    const [v] = db.seed('verifications', { bet_id: bet.id, status: 'under_review' })

    await PATCH(jsonRequest('http://x', REJECT, { method: 'PATCH' }) as never, params(v.id as string))
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
      const res = await PATCH(jsonRequest('http://x', { ...APPROVE, status }, { method: 'PATCH' }) as never, params(rejected.id as string))
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
    const res = await PATCH(jsonRequest('http://x', APPROVE, { method: 'PATCH' }) as never, params(v.id as string))
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
    await PATCH(jsonRequest('http://x', APPROVE, { method: 'PATCH' }) as never, params(v.id as string))
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

  /** A second admin, for the second signature. */
  const ADMIN_2: FakeUser = { id: '99999999-9999-4999-8999-999999999999', email: 'two@example.com' }
  const signedInAs = (user: FakeUser) => {
    db.seed('profiles', { id: user.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user }))
  }

  it('a payout takes two admins: one approves (verified → payout_approved), a different one marks it paid', async () => {
    const { PATCH, GET } = await loadBets()
    signedInAs(USER_A)
    const [bet] = db.seed('bets', { user_id: USER_B.id, status: 'verified', course_id: 'c', hole_id: 'h', tier: 'tier_1', stake_pence: 5000, potential_win_pence: 2_500_000, created_at: '2026-09-01T00:00:00Z' })
    db.seed('verifications', { bet_id: bet.id, status: 'approved' })

    const approve = await PATCH(jsonRequest('http://x', { status: 'payout_approved' }, { method: 'PATCH' }) as never, params(bet.id as string))
    expect(approve.status).toBe(200)
    expect(bet).toMatchObject({ status: 'payout_approved', payout_approved_by: USER_A.id, updated_by: USER_A.id })
    expect(typeof bet.payout_approved_at).toBe('string')
    expect(bet.payout_reference).toBeUndefined()

    // The approver sees that it was them, and is refused as the payer.
    const mine = await (await GET(new Request('http://x') as never, params(bet.id as string))).json()
    expect(mine).toMatchObject({ status: 'payout_approved', payoutApprovedBy: USER_A.id, payoutApprovedByViewer: true })
    const refused = await PATCH(jsonRequest('http://x', { status: 'paid', payoutReference: 'FNB-2026-09-15-0042' }, { method: 'PATCH' }) as never, params(bet.id as string))
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'A different admin must mark the payout as paid.', code: 'SECOND_APPROVER_REQUIRED' })
    expect(bet.status).toBe('payout_approved')

    signedInAs(ADMIN_2)
    const theirs = await (await GET(new Request('http://x') as never, params(bet.id as string))).json()
    expect(theirs).toMatchObject({ payoutApprovedBy: USER_A.id, payoutApprovedByViewer: false })
    const paid = await PATCH(jsonRequest('http://x', { status: 'paid', payoutReference: 'FNB-2026-09-15-0042' }, { method: 'PATCH' }) as never, params(bet.id as string))
    expect(paid.status).toBe(200)
    expect(bet).toMatchObject({ status: 'paid', payout_reference: 'FNB-2026-09-15-0042', payout_approved_by: USER_A.id, updated_by: ADMIN_2.id })
    expect(typeof db.rows('verifications')[0].payout_initiated_at).toBe('string')
  })

  it('marking paid still needs the bank reference, and approving does not take one', async () => {
    const { PATCH } = await loadBets()
    signedInAs(USER_A)
    const [bet] = db.seed('bets', { user_id: USER_B.id, status: 'payout_approved', payout_approved_by: ADMIN_2.id })
    const res = await PATCH(jsonRequest('http://x', { status: 'paid' }, { method: 'PATCH' }) as never, params(bet.id as string))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('PAYOUT_REFERENCE_REQUIRED')
    expect(bet.status).toBe('payout_approved')
  })

  it('refuses every other admin status change, including declaring results, approving directly, or paying in one step', async () => {
    const { PATCH } = await loadBets()
    db.seed('profiles', { id: USER_A.id, is_admin: true })
    serverClient.createClient.mockResolvedValue(createFakeClient(db, { user: USER_A }))
    const cases: [string, string][] = [['claimed', 'verified'], ['claimed', 'paid'], ['active', 'miss'], ['miss', 'claimed'], ['paid', 'verified'], ['active', 'paid'], ['verified', 'paid'], ['payout_approved', 'verified'], ['paid', 'payout_approved']]
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
