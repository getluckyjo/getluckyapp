/**
 * Seed a STAGING Supabase project with realistic, fake data.
 *
 *   STAGING_SUPABASE_URL=https://<ref>.supabase.co \
 *   STAGING_SUPABASE_SERVICE_ROLE_KEY=... \
 *     npm run staging:seed
 *
 * Creates (idempotently, keyed on email):
 *   - 1 admin (seed-admin@getlucky.test) and 24 golfers, all passing the age gate
 *   - courses + par-3 holes come from migration 001's seed
 *   - a spread of bets across every status and tier, with ledger rows for
 *     those that were "paid", verifications for the claimed ones, and a couple
 *     of deliberately awkward cases (amount mismatch, orphaned ledger row)
 *   - placeholder footage and documents in storage so the admin queue has
 *     something to open
 *
 * Every seeded user's password is printed once at the end so you can sign in
 * on the preview URL. Refuses to run against production.
 */
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.STAGING_SUPABASE_URL ?? ''
const SERVICE = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY ?? ''
const PRODUCTION_REF = 'ajsgzeofswlizwwdkesp'
const PASSWORD = process.env.STAGING_SEED_PASSWORD ?? 'seed-Passw0rd!'

if (!URL_ || !SERVICE) {
  console.error('STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(1)
}
if (URL_.includes(PRODUCTION_REF)) {
  console.error('Refusing: STAGING_SUPABASE_URL points at the production project.')
  process.exit(1)
}

const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })

const FIRST = ['Thabo', 'Sarah', 'James', 'Anika', 'Pete', 'Laura', 'Mike', 'Chloe', 'Sipho', 'Nadia', 'Kobus', 'Zanele', 'Dean', 'Priya', 'Ruan', 'Lerato', 'Ben', 'Amahle', 'Werner', 'Fatima', 'Neo', 'Marike', 'Tumi', 'Ockert']
const LAST = ['Mokoena', 'Reyneke', 'Khumalo', 'Naidoo', 'du Plessis', 'Smith', 'Oosthuizen', 'Botha', 'Dlamini', 'Patel', 'van Wyk', 'Ndlovu']
const TIERS = [
  ['tier_1', 5000, 2_500_000], ['tier_2', 10000, 6_000_000], ['tier_6', 15000, 10_000_000],
  ['tier_3', 25000, 20_000_000], ['tier_4', 50000, 50_000_000], ['tier_5', 100000, 100_000_000],
] as const

function pick<T>(arr: readonly T[], i: number): T { return arr[i % arr.length] }
function daysAgo(n: number) { return new Date(Date.now() - n * 86_400_000).toISOString() }

async function ensureUser(email: string, name: string, extra: Record<string, unknown> = {}) {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 })
  let user = list?.users.find(u => u.email === email)
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name },
    })
    if (error) throw error
    user = data.user
  }
  const { error } = await db.from('profiles').upsert({
    id: user.id, name, onboarding_done: true,
    date_of_birth: '1985-06-15', age_verified_at: daysAgo(30), terms_accepted_at: daysAgo(30),
    handicap: 8 + (name.length % 14),
    ...extra,
  })
  if (error) throw error
  return user.id
}

async function main() {
  console.log(`Seeding ${URL_}`)

  const adminId = await ensureUser('seed-admin@getlucky.test', 'Seed Admin', { is_admin: true })
  const golfers: string[] = []
  for (let i = 0; i < 24; i++) {
    const name = `${pick(FIRST, i)} ${pick(LAST, i)}`
    golfers.push(await ensureUser(`golfer${String(i + 1).padStart(2, '0')}@getlucky.test`, name,
      i === 23 ? { suspended_at: daysAgo(2), suspended_reason: 'Seed: suspended account' } : {}))
  }
  console.log(`users: 1 admin + ${golfers.length} golfers`)

  const { data: holes, error: holesErr } = await db.from('holes').select('id, course_id').eq('is_active', true)
  if (holesErr || !holes?.length) throw holesErr ?? new Error('No holes found. Run staging:bootstrap first.')

  // Wipe seeded bets so the script is repeatable.
  await db.from('bets').delete().in('user_id', golfers)
  await db.from('payfast_payments').delete().in('user_id', golfers)

  const STATUSES = ['miss', 'miss', 'miss', 'active', 'miss', 'claimed', 'miss', 'verified', 'miss', 'paid', 'miss', 'claimed'] as const
  let n = 0
  const stats: Record<string, number> = {}

  for (let i = 0; i < golfers.length; i++) {
    const userId = golfers[i]
    const betsForUser = 1 + (i % 4)
    for (let j = 0; j < betsForUser; j++) {
      n++
      const [tier, stake, win] = pick(TIERS, n)
      const hole = pick(holes, n)
      const status = pick(STATUSES, n)
      const created = daysAgo(60 - n)
      const mPaymentId = `gl_${tier}_${1_700_000_000_000 + n * 1000}`
      const pfPaymentId = String(1_089_000 + n)

      const { error: ledgerErr } = await db.from('payfast_payments').insert({
        m_payment_id: mPaymentId, pf_payment_id: pfPaymentId, user_id: userId,
        course_id: hole.course_id, hole_id: hole.id, tier, amount_cents: stake, status: 'complete',
        raw_payload: { seed: true, payment_status: 'COMPLETE', amount_gross: (stake / 100).toFixed(2) },
        created_at: created,
      })
      if (ledgerErr) throw ledgerErr

      const declared = status === 'active' ? {} : {
        declared_result: status === 'miss' ? 'miss' : 'win',
        declared_at: daysAgo(60 - n - 0.02),
      }
      const { data: bet, error: betErr } = await db.from('bets').insert({
        user_id: userId, course_id: hole.course_id, hole_id: hole.id, tier,
        stake_pence: stake, potential_win_pence: win, status,
        payment_intent_id: pfPaymentId, created_at: created,
        video_url: status === 'active' ? null : `${userId}/seed-${n}/shot.webm`,
        ...declared,
      }).select('id').single()
      if (betErr) throw betErr
      stats[status] = (stats[status] ?? 0) + 1

      if (status !== 'active' && status !== 'miss') {
        await db.storage.from('shot-videos').upload(`${userId}/seed-${n}/shot.webm`, new Blob(['seed footage placeholder']), { upsert: true, contentType: 'video/webm' })
      }

      if (status === 'claimed' || status === 'verified' || status === 'paid') {
        const certPath = `${bet.id}/certificate/certificate.txt`
        const affPath = `${bet.id}/affidavit/affidavit.txt`
        await db.storage.from('verification-docs').upload(certPath, new Blob([`Seed certificate for bet ${bet.id}`]), { upsert: true })
        await db.storage.from('verification-docs').upload(affPath, new Blob([`Seed affidavit for bet ${bet.id}`]), { upsert: true })
        const vStatus = status === 'claimed' ? (n % 2 ? 'documents_received' : 'under_review') : 'approved'
        const { error: vErr } = await db.from('verifications').upsert({
          bet_id: bet.id, status: vStatus, certificate_path: certPath, affidavit_path: affPath,
          footage_received_at: created, documents_received_at: created,
          ...(vStatus === 'approved' ? { verified_at: daysAgo(58 - n), reviewed_by: adminId, reviewer_notes: 'Seed: approved' } : {}),
          ...(status === 'paid' ? { payout_initiated_at: daysAgo(57 - n) } : {}),
        }, { onConflict: 'bet_id' })
        if (vErr) throw vErr
      }
    }
    await db.from('profiles').update({ total_attempts: betsForUser }).eq('id', userId)
  }

  // Awkward cases the admin tooling should cope with.
  await db.from('payfast_payments').insert({
    m_payment_id: 'gl_tier_5_seed_mismatch', pf_payment_id: '1099999', user_id: golfers[0],
    course_id: holes[0].course_id, hole_id: holes[0].id, tier: null, amount_cents: 5000, status: 'amount_mismatch',
    raw_payload: { seed: true, note: 'paid R50 against a R1000 tier' },
  })
  await db.from('payfast_payments').insert({
    m_payment_id: 'gl_tier_1_seed_orphan', pf_payment_id: '1099998', user_id: golfers[1],
    course_id: holes[1].course_id, hole_id: holes[1].id, tier: 'tier_1', amount_cents: 5000, status: 'complete',
    raw_payload: { seed: true, note: 'ITN landed, browser never came back: no bet exists' },
  })
  await db.from('leads').insert([
    { email: 'club@example.test', lane: 'partner', name: 'Seed Club', company: 'Seed Golf Club', note: 'Interested in hosting' },
    { email: 'investor@example.test', lane: 'investor', name: 'Seed Investor' },
  ])

  console.log(`bets: ${n} (${Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(', ')})`)
  console.log('ledger: +2 awkward rows (amount_mismatch, orphan)')
  console.log(`\nSign in on the preview URL with any seeded email and the password: ${PASSWORD}`)
  console.log('Admin: seed-admin@getlucky.test')
}

main().catch(err => { console.error(err); process.exit(1) })
