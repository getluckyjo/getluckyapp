#!/usr/bin/env node
/**
 * Bring a fresh Supabase project up to this repo's schema.
 *
 *   STAGING_DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
 *     npm run staging:bootstrap
 *
 * Applies supabase/migrations/*.sql in filename order, each inside its own
 * transaction except the ones that cannot run in one (ALTER TYPE ... ADD
 * VALUE), and records what it applied in public.schema_migrations so a
 * re-run is a no-op. It refuses to touch the production project.
 *
 * Use the SESSION pooler (port 5432) or the direct connection, not the
 * transaction pooler (6543): migrations use statements the transaction pooler
 * does not support.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const PRODUCTION_REF = 'ajsgzeofswlizwwdkesp'
const NO_TX = new Set(['004_tier_6.sql'])

const url = process.env.STAGING_DATABASE_URL
if (!url) {
  console.error('STAGING_DATABASE_URL is required (Supabase → Project Settings → Database → Connection string, session mode).')
  process.exit(1)
}
if (url.includes(PRODUCTION_REF)) {
  console.error(`Refusing: STAGING_DATABASE_URL points at the production project (${PRODUCTION_REF}).`)
  process.exit(1)
}

const dir = join(process.cwd(), 'supabase', 'migrations')
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

await client.query(`
  create table if not exists public.schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`)
const { rows: done } = await client.query('select name from public.schema_migrations')
const applied = new Set(done.map(r => r.name))

let count = 0
for (const file of files) {
  if (applied.has(file)) { console.log(`skip   ${file} (already applied)`); continue }
  const sql = readFileSync(join(dir, file), 'utf8')
  const tx = !NO_TX.has(file)
  process.stdout.write(`apply  ${file}${tx ? '' : ' (no transaction)'} … `)
  try {
    if (tx) await client.query('begin')
    await client.query(sql)
    await client.query('insert into public.schema_migrations (name) values ($1)', [file])
    if (tx) await client.query('commit')
    console.log('ok')
    count++
  } catch (err) {
    if (tx) await client.query('rollback').catch(() => {})
    console.log('FAILED')
    console.error(err.message)
    await client.end()
    process.exit(1)
  }
}

const { rows: tables } = await client.query(`
  select table_name from information_schema.tables
  where table_schema = 'public' order by table_name
`)
console.log(`\n${count} migration(s) applied. Tables: ${tables.map(t => t.table_name).join(', ')}`)
await client.end()
