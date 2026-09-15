/**
 * One connection to the staging database, two ways to open it:
 *
 *   1. STAGING_DATABASE_URL set → a Postgres connection with `pg` (session
 *      pooler, port 5432, or the direct connection).
 *   2. Otherwise, STAGING_PROJECT_REF set → every statement goes through the
 *      Supabase management API over HTTPS:
 *        POST https://api.supabase.com/v1/projects/<ref>/database/query
 *        { "query": "…" }
 *      for environments that cannot open raw Postgres connections. The
 *      caller's environment must supply the personal access token: either
 *      SUPABASE_ACCESS_TOKEN (sent as a bearer), or a proxy that attaches
 *      Authorization on the way out (leave SUPABASE_ACCESS_TOKEN unset).
 *
 * Both refuse the production project. Nothing here prints a key.
 *
 * `query(sql, params)` returns `{ rows }` in both modes. Over the API,
 * params are inlined as SQL literals (the endpoint takes no parameters), so
 * only pass values you trust: ids read from the same database, file names.
 * A multi-statement string runs as one implicit transaction in both modes,
 * which is what bootstrap relies on.
 */
export const PRODUCTION_REF = 'ajsgzeofswlizwwdkesp'
const REF_SHAPE = /^[a-z]{20}$/

function literal(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`
  return `'${String(v).replace(/'/g, "''")}'`
}

function inline(sql, params = []) {
  if (!params.length) return sql   // migration files may contain $1 inside function bodies; leave them alone
  return sql.replace(/\$(\d+)/g, (m, n) => {
    const i = Number(n) - 1
    if (i >= params.length) throw new Error(`query references $${n} but only ${params.length} param(s) given`)
    return literal(params[i])
  })
}

/** Which mode connect() will use, or null with a reason if neither is configured. */
export function describeMode() {
  const url = process.env.STAGING_DATABASE_URL
  const ref = process.env.STAGING_PROJECT_REF
  if (url) return { mode: 'pg' }
  if (ref) return { mode: 'api', ref }
  return {
    mode: null,
    reason: 'Set STAGING_DATABASE_URL (Supabase → Project Settings → Database → Connection string, session mode) '
      + 'or, where raw Postgres is unreachable, STAGING_PROJECT_REF to go through the management API.',
  }
}

export async function connect() {
  const { mode, ref, reason } = describeMode()
  if (!mode) { console.error(reason); process.exit(1) }

  if (mode === 'pg') {
    const url = process.env.STAGING_DATABASE_URL
    if (url.includes(PRODUCTION_REF)) {
      console.error(`Refusing: STAGING_DATABASE_URL points at the production project (${PRODUCTION_REF}).`)
      process.exit(1)
    }
    const { default: pg } = await import('pg')
    const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await client.connect()
    return {
      mode,
      label: 'Postgres (STAGING_DATABASE_URL)',
      query: (sql, params = []) => client.query(sql, params),
      end: () => client.end(),
    }
  }

  // mode === 'api'
  if (ref === PRODUCTION_REF) {
    console.error(`Refusing: STAGING_PROJECT_REF is the production project (${PRODUCTION_REF}).`)
    process.exit(1)
  }
  if (!REF_SHAPE.test(ref)) {
    console.error('STAGING_PROJECT_REF does not look like a Supabase project ref (20 lowercase letters).')
    process.exit(1)
  }
  const base = (process.env.SUPABASE_API_URL ?? 'https://api.supabase.com').replace(/\/$/, '')
  const endpoint = `${base}/v1/projects/${ref}/database/query`
  const headers = { 'content-type': 'application/json' }
  if (process.env.SUPABASE_ACCESS_TOKEN) headers.authorization = `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`

  return {
    mode,
    label: `management API (STAGING_PROJECT_REF …${ref.slice(-4)})`,
    async query(sql, params = []) {
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: inline(sql, params) }) })
      const text = await res.text()
      let body
      try { body = text ? JSON.parse(text) : [] } catch { body = text }
      if (!res.ok) {
        const msg = typeof body === 'object' && body !== null ? (body.message ?? body.error ?? JSON.stringify(body)) : String(body)
        const err = new Error(`management API ${res.status}: ${String(msg).slice(0, 500)}`)
        err.status = res.status
        throw err
      }
      return { rows: Array.isArray(body) ? body : [] }
    },
    end: async () => {},
  }
}
