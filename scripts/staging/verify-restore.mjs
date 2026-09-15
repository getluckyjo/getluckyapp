#!/usr/bin/env node
/**
 * Prove a restored database is whole. Run against the project you restored
 * INTO (never production) and compare the output with the same command run
 * against the source before the restore.
 *
 *   STAGING_DATABASE_URL='postgresql://…' npm run staging:verify-restore
 *
 * Prints row counts, the newest row per money table, ledger/bet consistency,
 * and a fingerprint of the ledger so two runs can be diffed by eye.
 */
import pg from 'pg'

const PRODUCTION_REF = 'ajsgzeofswlizwwdkesp'
const url = process.env.STAGING_DATABASE_URL
if (!url) { console.error('STAGING_DATABASE_URL is required'); process.exit(1) }
if (url.includes(PRODUCTION_REF)) { console.error('Refusing to run against production.'); process.exit(1) }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

const q = async (sql) => (await client.query(sql)).rows

console.log('\n== Row counts')
console.table(await q(`
  select 'auth.users' as t, count(*)::int as n from auth.users
  union all select 'profiles', count(*) from public.profiles
  union all select 'courses', count(*) from public.courses
  union all select 'holes', count(*) from public.holes
  union all select 'bets', count(*) from public.bets
  union all select 'verifications', count(*) from public.verifications
  union all select 'payfast_payments', count(*) from public.payfast_payments
  union all select 'leads', count(*) from public.leads
  union all select 'storage.objects', count(*) from storage.objects
`))

console.log('== Newest rows (are we missing the tail?)')
console.table(await q(`
  select 'bets' as t, max(created_at) as newest from public.bets
  union all select 'payfast_payments', max(created_at) from public.payfast_payments
  union all select 'verifications', max(created_at) from public.verifications
  union all select 'profiles', max(created_at) from public.profiles
`))

console.log('== Money consistency')
console.table(await q(`
  select
    (select count(*)::int from public.bets b where b.payment_intent_id is not null
       and not exists (select 1 from public.payfast_payments p where p.m_payment_id = b.payment_intent_id or p.pf_payment_id = b.payment_intent_id)) as bets_without_ledger,
    (select count(*)::int from public.payfast_payments p where p.status = 'complete'
       and not exists (select 1 from public.bets b where b.payment_intent_id in (p.m_payment_id, p.pf_payment_id))) as ledger_without_bet,
    (select count(*)::int from public.bets where status in ('verified','paid')) as verified_or_paid,
    (select count(*)::int from public.verifications where status = 'approved') as approved_verifications
`))

console.log('== Ledger fingerprint (compare with the source)')
console.table(await q(`
  select count(*)::int as rows, coalesce(sum(amount_cents),0)::bigint as total_cents,
         md5(string_agg(m_payment_id, ',' order by m_payment_id)) as ids_md5
  from public.payfast_payments
`))

console.log('== RLS enabled on every public table?')
console.table(await q(`
  select relname as table, relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and relkind = 'r' order by relname
`))

await client.end()
