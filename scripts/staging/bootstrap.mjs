#!/usr/bin/env node
/**
 * Bring a fresh Supabase project up to this repo's schema.
 *
 *   STAGING_DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
 *     npm run staging:bootstrap
 *
 * or, where raw Postgres connections are not possible, through the Supabase
 * management API (the access token comes from SUPABASE_ACCESS_TOKEN or a
 * proxy that attaches it; see scripts/staging/db.mjs):
 *
 *   STAGING_PROJECT_REF=<ref> npm run staging:bootstrap
 *
 * Applies supabase/migrations/*.sql in filename order, each together with
 * its schema_migrations row as one implicit transaction (a multi-statement
 * string), except the ones that cannot run in one (ALTER TYPE ... ADD
 * VALUE), and records what it applied in public.schema_migrations so a
 * re-run is a no-op. It refuses to touch the production project.
 *
 * Use the SESSION pooler (port 5432) or the direct connection, not the
 * transaction pooler (6543): migrations use statements the transaction pooler
 * does not support.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect } from './db.mjs'

const NO_TX = new Set(['004_tier_6.sql'])

const dir = join(process.cwd(), 'supabase', 'migrations')
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

const db = await connect()
console.log(`bootstrap via ${db.label}`)

await db.query(`
  create table if not exists public.schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )
`)
const { rows: done } = await db.query('select name from public.schema_migrations')
const applied = new Set(done.map(r => r.name))

const RECORD = 'insert into public.schema_migrations (name) values ($1)'

let count = 0
for (const file of files) {
  if (applied.has(file)) { console.log(`skip   ${file} (already applied)`); continue }
  const sql = readFileSync(join(dir, file), 'utf8')
  const tx = !NO_TX.has(file)
  process.stdout.write(`apply  ${file}${tx ? '' : ' (no transaction)'} … `)
  try {
    if (tx) {
      // One string, one implicit transaction: the migration and its record
      // land together or not at all, in both modes.
      await db.query(`${sql.trim().replace(/;\s*$/, '')};\n${RECORD.replace('$1', "'" + file + "'")};`)
    } else {
      await db.query(sql)
      await db.query(RECORD, [file])
    }
    console.log('ok')
    count++
  } catch (err) {
    console.log('FAILED')
    console.error(err.message)
    await db.end()
    process.exit(1)
  }
}

const { rows: tables } = await db.query(`
  select table_name from information_schema.tables
  where table_schema = 'public' order by table_name
`)
console.log(`\n${count} migration(s) applied. Tables: ${tables.map(t => t.table_name).join(', ')}`)
await db.end()
