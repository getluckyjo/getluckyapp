#!/usr/bin/env node
/**
 * Event-day load test (Stage 4, Batch 12; docs/batch-12-scale.md).
 *
 * 120 golfers each buy an entry, record, upload, seal and resolve it, ten
 * percent of them with a full claim; an admin pages the queue and opens
 * claims throughout. The two hours of the real event are compressed into
 * LOAD_MINUTES (default 10), so the default run is 12× the real rate.
 *
 * Runs against a Vercel *preview* deployment pointed at the staging Supabase
 * project. PayFast is stood in for by writing the ledger row the ITN would
 * write. Emails go to Resend's delivered@resend.dev sink.
 *
 *   BASE_URL=https://<preview>.vercel.app \
 *   STAGING_SUPABASE_URL=https://<ref>.supabase.co \
 *   STAGING_SUPABASE_ANON_KEY=… STAGING_SUPABASE_SERVICE_ROLE_KEY=… \
 *   npm run load:event-day            # add -- --cleanup to delete the load users afterwards
 *
 * Refuses to run against production. Writes load-report.json next to itself.
 */
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const PRODUCTION_REF = 'ajsgzeofswlizwwdkesp'
const env = (k, d) => process.env[k] ?? d
const BASE_URL = env('BASE_URL', '').replace(/\/$/, '')
const SUPABASE_URL = env('STAGING_SUPABASE_URL', '')
const ANON = env('STAGING_SUPABASE_ANON_KEY', '')
const SERVICE = env('STAGING_SUPABASE_SERVICE_ROLE_KEY', '')
const PASSWORD = env('STAGING_SEED_PASSWORD', 'seed-Passw0rd!')
const GOLFERS = Number(env('LOAD_GOLFERS', 120))
const MINUTES = Number(env('LOAD_MINUTES', 10))
const CLAIM_RATE = Number(env('LOAD_CLAIM_RATE', 0.1))
const VIDEO_BYTES = Number(env('LOAD_VIDEO_BYTES', 2_000_000))
const CLEANUP = process.argv.includes('--cleanup')

for (const [k, v] of Object.entries({ BASE_URL, STAGING_SUPABASE_URL: SUPABASE_URL, STAGING_SUPABASE_ANON_KEY: ANON, STAGING_SUPABASE_SERVICE_ROLE_KEY: SERVICE })) {
  if (!v) { console.error(`${k} is required`); process.exit(1) }
}
if (SUPABASE_URL.includes(PRODUCTION_REF) || BASE_URL.includes('getluckyholeinone.com')) {
  console.error('Refusing to run against production.'); process.exit(1)
}

const service = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })

// ── timing ────────────────────────────────────────────────────────────────
const samples = new Map()   // step → [{ ms, ok, status }]
function record(step, ms, ok, status) {
  if (!samples.has(step)) samples.set(step, [])
  samples.get(step).push({ ms, ok, status })
}
async function timed(step, fn) {
  const t0 = performance.now()
  try {
    const out = await fn()
    record(step, performance.now() - t0, true, out?.status ?? 200)
    return out
  } catch (err) {
    record(step, performance.now() - t0, false, err.status ?? 0)
    throw err
  }
}
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }

// ── a golfer's browser: session cookies exactly as @supabase/ssr writes them ──
async function signIn(email) {
  const jar = new Map()
  const client = createServerClient(SUPABASE_URL, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: list => list.forEach(c => jar.set(c.name, c.value)),
    },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign in ${email}: ${error.message}`)
  const cookie = [...jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join('; ')
  return { client, cookie, userId: data.user.id }
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { cookie, 'content-type': 'application/json', 'user-agent': 'GetLuckyLoadTest/1.0' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok && res.status !== 202) {
    const err = new Error(`${method} ${path} → ${res.status} ${json.error ?? ''}`)
    err.status = res.status
    throw err
  }
  return Object.assign(json, { status: res.status })
}

// ── users ─────────────────────────────────────────────────────────────────
async function ensureLoadUser(i) {
  const email = `load-golfer${String(i).padStart(3, '0')}@getlucky.test`
  const { data: list } = await service.auth.admin.listUsers({ perPage: 1000 })
  let user = list?.users.find(u => u.email === email)
  if (!user) {
    const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: `Load Golfer ${i}` } })
    if (error) throw new Error(`create ${email}: ${error.message}`)
    user = data.user
  }
  await service.from('profiles').upsert({ id: user.id, name: `Load Golfer ${i}`, onboarding_done: true, age_verified_at: new Date().toISOString(), terms_accepted_at: new Date().toISOString(), date_of_birth: '1990-01-01' })
  return email
}

// ── one golfer's event ────────────────────────────────────────────────────
async function golfer(i, target, claim) {
  const email = await ensureLoadUser(i)
  const { client, cookie, userId } = await timed('sign_in', () => signIn(email))

  const checkout = await timed('checkout', () => api(cookie, 'POST', '/api/payments/payfast', { tier: 'tier_1', courseId: target.courseId, holeId: target.holeId }))
  const mPaymentId = checkout.m_payment_id

  await timed('ledger_write (stands in for ITN)', async () => {
    const { error } = await service.from('payfast_payments').upsert({
      m_payment_id: mPaymentId, pf_payment_id: `load-${randomBytes(4).toString('hex')}`, user_id: userId,
      course_id: target.courseId, hole_id: target.holeId, tier: 'tier_1', amount_cents: 5000, status: 'complete', raw_payload: { load_test: true },
    }, { onConflict: 'm_payment_id' })
    if (error) throw new Error(error.message)
  })

  let betId
  for (let attempt = 0; attempt < 8 && !betId; attempt++) {
    const r = await timed('bet_create', () => api(cookie, 'POST', '/api/bets/create', { paymentIntentId: mPaymentId, tier: 'tier_1', courseId: target.courseId, holeId: target.holeId }))
    if (r.status === 202) await new Promise(r => setTimeout(r, 1000))
    else betId = r.betId
  }
  if (!betId) throw new Error('bet never created')

  const startedAt = new Date(Date.now() - 20_000).toISOString()
  const slot = await timed('upload_url', () => api(cookie, 'POST', '/api/videos/upload-url', {
    betId, mimeType: 'video/webm',
    capture: { startedAt, endedAt: new Date().toISOString(), durationMs: 20_000, lat: target.lat ?? -34, lng: target.lng ?? 22, accuracyM: 10 },
  }))
  await timed('video_put', async () => {
    const res = await fetch(slot.signedUrl, { method: 'PUT', headers: { 'content-type': 'video/webm' }, body: randomBytes(VIDEO_BYTES) })
    if (!res.ok) { const e = new Error(`PUT ${res.status}`); e.status = res.status; throw e }
  })
  await timed('video_seal', () => api(cookie, 'POST', '/api/videos/uploaded', { betId }))

  if (!claim) {
    await timed('declare_miss', () => api(cookie, 'PATCH', `/api/bets/${betId}`, { status: 'miss' }))
  } else {
    const cert = `${userId}/${betId}/certificate/${Date.now()}-cert.pdf`
    const aff = `${userId}/${betId}/affidavit/${Date.now()}-aff.pdf`
    await timed('docs_upload', async () => {
      for (const p of [cert, aff]) {
        const { error } = await client.storage.from('verification-docs').upload(p, randomBytes(50_000), { contentType: 'application/pdf', upsert: false })
        if (error) throw new Error(error.message)
      }
    })
    await timed('claim_submit', () => api(cookie, 'POST', `/api/verifications/${betId}`, {
      certificatePath: cert, affidavitPath: aff,
      witnesses: [{ role: 'witness', name: 'Load Witness', email: 'delivered@resend.dev' }],
    }))
  }
  await timed('history', () => api(cookie, 'GET', '/api/bets'))
  return { cookie }
}

// ── the admin, paging the queue throughout ────────────────────────────────
async function adminLoop(stop) {
  const { cookie } = await signIn('seed-admin@getlucky.test')
  while (!stop.done) {
    try {
      const q = await timed('admin_queue', () => api(cookie, 'GET', '/api/admin/verifications?sort=risk&limit=20'))
      await timed('admin_stats', () => api(cookie, 'GET', '/api/admin/stats'))
      const pick = q.data?.[Math.floor(Math.random() * (q.data?.length || 1))]
      if (pick) await timed('admin_detail', () => api(cookie, 'GET', `/api/admin/verifications/${pick.id}`))
    } catch { /* recorded */ }
    await new Promise(r => setTimeout(r, 5000))
  }
}

// ── run ───────────────────────────────────────────────────────────────────
const { data: course } = await service.from('courses').select('id, name, lat, lng').eq('is_partner', true).limit(1).maybeSingle()
if (!course) { console.error('No partner course on staging; run npm run staging:seed first.'); process.exit(1) }
const { data: hole } = await service.from('holes').select('id').eq('course_id', course.id).eq('is_active', true).limit(1).maybeSingle()
if (!hole) { console.error(`No active hole at ${course.name}.`); process.exit(1) }
const target = { courseId: course.id, holeId: hole.id, lat: course.lat, lng: course.lng }

console.log(`event-day: ${GOLFERS} golfers over ${MINUTES} min at ${course.name}, ${Math.round(GOLFERS * CLAIM_RATE)} claims, video ${(VIDEO_BYTES / 1e6).toFixed(1)} MB → ${BASE_URL}`)
const stop = { done: false }
const adminRun = adminLoop(stop).catch(err => console.error('admin loop:', err.message))
const t0 = performance.now()
const cookies = []
const runs = []
for (let i = 1; i <= GOLFERS; i++) {
  const delay = ((i - 1) / GOLFERS) * MINUTES * 60_000
  const claim = i % Math.round(1 / CLAIM_RATE) === 0
  runs.push(new Promise(r => setTimeout(r, delay)).then(() => golfer(i, target, claim)).then(g => cookies.push(g.cookie)).catch(err => {
    record('golfer_failed', 0, false, err.status ?? 0)
    console.error(`golfer ${i}: ${err.message}`)
  }))
}
await Promise.all(runs)
stop.done = true
await adminRun
const wallMs = performance.now() - t0

// ── report ────────────────────────────────────────────────────────────────
const report = { baseUrl: BASE_URL, golfers: GOLFERS, minutes: MINUTES, claimRate: CLAIM_RATE, videoBytes: VIDEO_BYTES, wallSeconds: Math.round(wallMs / 1000), steps: {} }
const table = []
for (const [step, list] of samples) {
  const ok = list.filter(s => s.ok).map(s => s.ms)
  const row = { step, n: list.length, errors: list.length - ok.length, p50: Math.round(pct(ok, 0.5)), p95: Math.round(pct(ok, 0.95)), max: Math.round(Math.max(0, ...ok)) }
  report.steps[step] = row
  table.push(row)
}
console.table(table)
writeFileSync(new URL('./load-report.json', import.meta.url), JSON.stringify(report, null, 2))
console.log('written scripts/load/load-report.json')

if (CLEANUP) {
  console.log('cleanup: deleting load users through the app…')
  let n = 0
  for (const cookie of cookies) {
    try { await api(cookie, 'DELETE', '/api/account'); n++ } catch (err) { console.error('cleanup:', err.message) }
  }
  console.log(`deleted ${n} accounts (blocked ones, with open claims, need an admin decision first)`)
}
