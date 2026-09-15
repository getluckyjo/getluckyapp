// One-off prod SQL runner. Usage:
//   DATABASE_URL='postgresql://...' node scripts/run-sql.mjs supabase/migrations/010_admin_queries.sql
// Reads connection from DATABASE_URL env (never hard-coded / committed).
import { readFileSync } from 'node:fs'
import pg from 'pg'

const url = process.env.DATABASE_URL
const file = process.argv[2]
if (!file) { console.error('Usage: node scripts/run-sql.mjs <file.sql>'); process.exit(1) }
// Either DATABASE_URL, or discrete PG* env vars (PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT).
if (!url && !process.env.PGHOST) { console.error('Missing DATABASE_URL or PGHOST env'); process.exit(1) }

const sql = readFileSync(file, 'utf8')
const client = new pg.Client(
  url ? { connectionString: url, ssl: { rejectUnauthorized: false } }
      : { ssl: { rejectUnauthorized: false } }
)

try {
  await client.connect()
  // ALTER TYPE ... ADD VALUE and a few other statements can't run in a tx — set NO_TX=1.
  const useTx = process.env.NO_TX !== '1'
  console.log('Connected. Running', file, useTx ? 'in a transaction...' : '(no transaction)...')
  if (useTx) await client.query('begin')
  const res = await client.query(sql)
  if (useTx) await client.query('commit')
  // Print the last SELECT result set (the verify query) if present
  const last = Array.isArray(res) ? res[res.length - 1] : res
  if (last?.rows?.length) {
    console.log('\nVerify result:')
    console.table(last.rows)
  } else {
    console.log('\nDone (no rows returned from final statement).')
  }
} catch (err) {
  try { await client.query('rollback') } catch {}
  console.error('\n❌ SQL failed — rolled back:', err.message)
  process.exit(1)
} finally {
  await client.end()
}
