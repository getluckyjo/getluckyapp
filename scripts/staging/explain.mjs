#!/usr/bin/env node
/**
 * Query timings for the admin and player reads, before and after migration
 * 010. Run it twice against staging (once before applying 010, once after)
 * and paste both tables into docs/batch-6-admin-queries.md.
 *
 *   STAGING_DATABASE_URL='postgresql://…' node scripts/staging/explain.mjs
 *
 * Refuses to run against production. Read-only (EXPLAIN ANALYZE executes the
 * SELECTs but changes nothing).
 */
import pg from 'pg'

const PRODUCTION_REF = 'ajsgzeofswlizwwdkesp'
const url = process.env.STAGING_DATABASE_URL
if (!url) { console.error('STAGING_DATABASE_URL is required'); process.exit(1) }
if (url.includes(PRODUCTION_REF)) { console.error('Refusing to run against production.'); process.exit(1) }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

const { rows: [{ user_id, course_id }] } = await client.query(
  `select user_id, course_id from public.bets order by created_at desc limit 1`,
).catch(() => ({ rows: [{ user_id: null, course_id: null }] }))

const QUERIES = [
  ['admin bets list (newest 20)',         `select * from public.bets order by created_at desc limit 20`],
  ['admin bets by status (active)',       `select * from public.bets where status = 'active' order by created_at desc limit 20`],
  ['player history (one user)',           `select * from public.bets where user_id = $1 order by created_at desc limit 200`, [user_id]],
  ['verification queue (oldest 20)',      `select * from public.verifications where status in ('pending','documents_received','under_review') order by created_at limit 20`],
  ['holes for a course',                  `select * from public.holes where course_id = $1 order by hole_number`, [course_id]],
  ['admin user search by email',          `select id, name, email from public.profiles where lower(email) like '%golfer0%' limit 20`],
  ['dashboard totals (admin_totals)',     `select public.admin_totals()`],
  ['revenue by tier',                     `select * from public.admin_revenue_by_tier()`],
  ['revenue by course',                   `select * from public.admin_revenue_by_course()`],
  ['dashboard totals (old way: all bets)',`select stake_pence, potential_win_pence, status from public.bets`],
]

const results = []
for (const [label, sql, params = []] of QUERIES) {
  if (params.some(p => p === null)) { results.push({ query: label, note: 'skipped: no data' }); continue }
  try {
    const { rows } = await client.query(`explain (analyze, format json) ${sql}`, params)
    const plan = rows[0]['QUERY PLAN'][0]
    const root = plan.Plan
    const scans = []
    ;(function walk(n) {
      if (/Seq Scan/.test(n['Node Type'])) scans.push(`SeqScan ${n['Relation Name']}`)
      if (/Index/.test(n['Node Type'])) scans.push(`${n['Node Type'].replace(' Scan', '')} ${n['Index Name'] ?? ''}`.trim())
      for (const c of n.Plans ?? []) walk(c)
    })(root)
    results.push({
      query: label,
      'exec ms': Number(plan['Execution Time'].toFixed(2)),
      'plan ms': Number(plan['Planning Time'].toFixed(2)),
      rows: root['Actual Rows'],
      access: [...new Set(scans)].join(', ') || root['Node Type'],
    })
  } catch (err) {
    results.push({ query: label, note: err.message.slice(0, 80) })
  }
}
console.table(results)
await client.end()
