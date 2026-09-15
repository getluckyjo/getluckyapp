/**
 * Row Level Security, tested for real against the STAGING Supabase project.
 *
 * These tests talk to PostgREST with the anon key and a normal user's JWT,
 * exactly as an attacker would, and assert what that user must NOT be able to
 * do. They are skipped unless the staging credentials are present, so `npm
 * test` stays green on a laptop with no network and in CI without secrets.
 *
 *   STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co \
 *   STAGING_SUPABASE_ANON_KEY=... \
 *   STAGING_SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run test:staging
 *
 * The second group asserts the holes documented in AUDIT.md B.1 are closed by
 * migration 006. They fail against a project that has not applied it.
 *
 * The suite refuses to run against the production project.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL_ = process.env.STAGING_SUPABASE_URL ?? ''
const ANON = process.env.STAGING_SUPABASE_ANON_KEY ?? ''
const SERVICE = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY ?? ''
const PRODUCTION_REF = 'ajsgzeofswlizwwdkesp'

const configured = !!(URL_ && ANON && SERVICE)
if (configured && URL_.includes(PRODUCTION_REF)) {
  throw new Error('rls.staging.test.ts: STAGING_SUPABASE_URL points at the PRODUCTION project. Refusing to run.')
}

describe.skipIf(!configured)('RLS as a normal signed-in user (staging)', () => {
  let admin: SupabaseClient
  let mallory: SupabaseClient
  let aliceId: string
  let malloryId: string
  const created: string[] = []

  async function signUp(label: string) {
    const email = `rls-${label}-${Date.now()}@example.test`
    const password = 'Str0ng-passw0rd-for-tests!'
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw error ?? new Error('createUser failed')
    created.push(data.user.id)
    const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
    if (signInErr) throw signInErr
    return { client, id: data.user.id }
  }

  beforeAll(async () => {
    admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
    aliceId = (await signUp('alice')).id
    const m = await signUp('mallory'); mallory = m.client; malloryId = m.id
  }, 30_000)

  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id)
  })

  // ── Things that must already hold today ─────────────────────────────────

  it('cannot read another user\'s profile', async () => {
    const { data } = await mallory.from('profiles').select('id').eq('id', aliceId)
    expect(data).toEqual([])
  })

  it('cannot read another user\'s bets', async () => {
    const { data: bet } = await admin.from('bets').insert({
      user_id: aliceId, course_id: await anyCourse(), hole_id: await anyHole(), tier: 'tier_1',
      stake_pence: 5000, potential_win_pence: 2_500_000, status: 'active',
    }).select('id').single()
    const { data } = await mallory.from('bets').select('id').eq('id', bet!.id)
    expect(data).toEqual([])
  })

  it('cannot write the payments ledger', async () => {
    const { error } = await mallory.from('payfast_payments').insert({
      m_payment_id: `forged-${Date.now()}`, user_id: malloryId, tier: 'tier_5', amount_cents: 100000, status: 'complete',
    })
    expect(error).not.toBeNull()
  })

  it('cannot read the leads table', async () => {
    const { data, error } = await mallory.from('leads').select('email')
    expect(error ?? data).not.toBeNull()
    expect(data ?? []).toEqual([])
  })

  it('cannot upload into another user\'s shot-videos folder', async () => {
    const { error } = await mallory.storage.from('shot-videos').upload(`${aliceId}/x/shot.webm`, new Blob(['x']))
    expect(error).not.toBeNull()
  })

  // ── Closed by migration 006 (AUDIT.md B.1, Batch 1) ─────────────────────

  it('cannot grant themselves is_admin', async () => {
    await mallory.from('profiles').update({ is_admin: true }).eq('id', malloryId)
    const { data } = await admin.from('profiles').select('is_admin').eq('id', malloryId).single()
    expect(data?.is_admin).not.toBe(true)
  })

  it('cannot set their own age_verified_at', async () => {
    await mallory.from('profiles').update({ age_verified_at: new Date().toISOString() }).eq('id', malloryId)
    const { data } = await admin.from('profiles').select('age_verified_at').eq('id', malloryId).single()
    expect(data?.age_verified_at).toBeNull()
  })

  it('cannot insert a bet directly (no free bets)', async () => {
    const { error } = await mallory.from('bets').insert({
      user_id: malloryId, course_id: await anyCourse(), hole_id: await anyHole(), tier: 'tier_5',
      stake_pence: 0, potential_win_pence: 100_000_000, status: 'active',
    })
    expect(error).not.toBeNull()
  })

  it('cannot mark their own bet verified or paid', async () => {
    const { data: bet } = await admin.from('bets').insert({
      user_id: malloryId, course_id: await anyCourse(), hole_id: await anyHole(), tier: 'tier_1',
      stake_pence: 5000, potential_win_pence: 2_500_000, status: 'active',
    }).select('id').single()
    await mallory.from('bets').update({ status: 'paid', potential_win_pence: 100_000_000 }).eq('id', bet!.id)
    const { data } = await admin.from('bets').select('status, potential_win_pence').eq('id', bet!.id).single()
    expect(data).toEqual({ status: 'active', potential_win_pence: 2_500_000 })
  })

  it('cannot approve their own verification', async () => {
    const { data: bet } = await admin.from('bets').insert({
      user_id: malloryId, course_id: await anyCourse(), hole_id: await anyHole(), tier: 'tier_1',
      stake_pence: 5000, potential_win_pence: 2_500_000, status: 'claimed',
    }).select('id').single()
    const { error } = await mallory.from('verifications').insert({ bet_id: bet!.id, status: 'approved', verified_at: new Date().toISOString() })
    expect(error).not.toBeNull()
  })

  it('cannot list or read other users\' verification documents', async () => {
    await admin.storage.from('verification-docs').upload(`${aliceId}/some-bet/certificate/cert.txt`, new Blob(['secret']), { upsert: true })
    const { data: listing } = await mallory.storage.from('verification-docs').list(aliceId)
    expect(listing ?? []).toEqual([])
    const { data: file } = await mallory.storage.from('verification-docs').download(`${aliceId}/some-bet/certificate/cert.txt`)
    expect(file).toBeNull()
  })

  it('cannot call increment_attempts for another user', async () => {
    const { data: before } = await admin.from('profiles').select('total_attempts').eq('id', aliceId).single()
    await mallory.rpc('increment_attempts', { user_id: aliceId })
    const { data: after } = await admin.from('profiles').select('total_attempts').eq('id', aliceId).single()
    expect(after?.total_attempts).toBe(before?.total_attempts)
  })

  async function anyCourse() {
    const { data } = await admin.from('courses').select('id').limit(1).single()
    return data!.id as string
  }
  async function anyHole() {
    const { data } = await admin.from('holes').select('id').limit(1).single()
    return data!.id as string
  }
})
