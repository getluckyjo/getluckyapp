/**
 * In-memory stand-in for the Supabase JS client, just deep enough to run the
 * real route handlers against it.
 *
 * It models what the money-path routes actually use of PostgREST: a chainable
 * query builder (`from().select().eq().maybeSingle()` and friends), `rpc()`,
 * `auth.getUser()`, and `storage.from().createSignedUploadUrl()`. Rows live in
 * a plain Map so a test can seed state, run a handler, and read back exactly
 * what was written.
 *
 * It deliberately does NOT model Row Level Security: these tests exercise the
 * handlers' own checks. RLS is covered separately by `rls.staging.test.ts`
 * against a real project.
 *
 * Two constraints from the schema are modelled because the handlers branch on
 * them: the partial unique index on `bets.payment_intent_id` (error 23505) and
 * the unique `payfast_payments.m_payment_id` that `upsert(onConflict)` targets.
 */
import { randomUUID } from 'node:crypto'

type Row = Record<string, unknown>
type Filter = (row: Row) => boolean

export interface FakeUser {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
}

interface PostgrestError {
  code: string
  message: string
  details?: string
}

interface Result<T = unknown> {
  data: T
  error: PostgrestError | null
  count?: number | null
}

const UNIQUE: Record<string, string[]> = {
  bets: ['payment_intent_id'],
  payfast_payments: ['m_payment_id'],
  verifications: ['bet_id'],
}

export class FakeDb {
  tables = new Map<string, Row[]>()
  /** Storage objects by bucket, path → content. */
  objects = new Map<string, Map<string, string>>()
  /** Ids passed to auth.admin.deleteUser(), in order. */
  deletedUsers: string[] = []

  bucket(name: string): Map<string, string> {
    if (!this.objects.has(name)) this.objects.set(name, new Map())
    return this.objects.get(name)!
  }

  putObject(bucket: string, path: string, content = 'bytes'): void {
    this.bucket(bucket).set(path, content)
  }

  objectPaths(bucket: string): string[] {
    return [...this.bucket(bucket).keys()].sort()
  }

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, [])
    return this.tables.get(table)!
  }

  seed(table: string, ...rows: Row[]): Row[] {
    const stored = rows.map(r => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }))
    this.rows(table).push(...stored)
    return stored
  }

  find(table: string, pred: (r: Row) => boolean): Row | undefined {
    return this.rows(table).find(pred)
  }
}

export class Builder implements PromiseLike<Result> {
  private filters: Filter[] = []
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private payload: Row | Row[] | null = null
  private onConflict: string | null = null
  private wantCount = false
  private singleMode: 'one' | 'maybe' | null = null
  private limitN: number | null = null
  private rangeN: [number, number] | null = null
  private orderBy: { col: string; asc: boolean } | null = null
  private returning = false

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') this.returning = true
    if (opts?.count) this.wantCount = true
    return this
  }
  insert(payload: Row | Row[]) { this.op = 'insert'; this.payload = payload; return this }
  update(payload: Row) { this.op = 'update'; this.payload = payload; return this }
  upsert(payload: Row, opts?: { onConflict?: string }) {
    this.op = 'upsert'; this.payload = payload; this.onConflict = opts?.onConflict ?? 'id'; return this
  }
  delete() { this.op = 'delete'; return this }

  eq(col: string, val: unknown) { this.filters.push(r => r[col] === val); return this }
  neq(col: string, val: unknown) { this.filters.push(r => r[col] !== val); return this }
  in(col: string, vals: unknown[]) { this.filters.push(r => vals.includes(r[col])); return this }
  is(col: string, val: unknown) { this.filters.push(r => (val === null ? r[col] == null : r[col] === val)); return this }
  not(col: string, _op: string, val: unknown) { this.filters.push(r => (val === null ? r[col] != null : r[col] !== val)); return this }
  gte(col: string, val: string) { this.filters.push(r => String(r[col]) >= val); return this }
  lte(col: string, val: string) { this.filters.push(r => String(r[col]) <= val); return this }
  ilike(col: string, val: string) {
    const needle = val.replace(/%/g, '').toLowerCase()
    this.filters.push(r => String(r[col] ?? '').toLowerCase().includes(needle)); return this
  }
  /** PostgREST `.or('a.eq.1,b.in.(x,y),c.ilike.*z*')` — enough of the grammar for the routes. */
  or(expr: string) {
    const parts: string[] = []
    let depth = 0, cur = ''
    for (const ch of expr) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
    }
    if (cur) parts.push(cur)
    const conds: Filter[] = parts.map(p => {
      const m = /^([a-z_]+)\.(eq|in|ilike)\.([^]*)$/.exec(p.trim())
      if (!m) throw new Error(`fake or(): cannot parse "${p}"`)
      const [, col, op, val] = m
      if (op === 'eq') return r => String(r[col]) === val
      if (op === 'in') { const set = new Set(val.slice(1, -1).split(',')); return r => set.has(String(r[col])) }
      const needle = val.replace(/[*%]/g, '').toLowerCase()
      return r => String(r[col] ?? '').toLowerCase().includes(needle)
    })
    this.filters.push(r => conds.some(c => c(r)))
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy = { col, asc: opts?.ascending !== false }; return this }
  limit(n: number) { this.limitN = n; return this }
  range(a: number, b: number) { this.rangeN = [a, b]; return this }
  maybeSingle() { this.singleMode = 'maybe'; return this }
  single() { this.singleMode = 'one'; return this }

  private matching(): Row[] {
    let rows = this.db.rows(this.table).filter(r => this.filters.every(f => f(r)))
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      const cmp = (x: unknown, y: unknown) =>
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0
      rows = [...rows].sort((a, b) => cmp(a[col], b[col]) * (asc ? 1 : -1))
    }
    if (this.rangeN) rows = rows.slice(this.rangeN[0], this.rangeN[1] + 1)
    if (this.limitN != null) rows = rows.slice(0, this.limitN)
    return rows
  }

  private uniqueViolation(row: Row, ignoreId?: unknown): PostgrestError | null {
    for (const col of UNIQUE[this.table] ?? []) {
      if (row[col] == null) continue
      const clash = this.db.rows(this.table).find(r => r[col] === row[col] && r.id !== ignoreId)
      if (clash) {
        return {
          code: '23505',
          message: `duplicate key value violates unique constraint "${this.table}_${col}_key"`,
          details: `Key (${col})=(${String(row[col])}) already exists.`,
        }
      }
    }
    return null
  }

  private shape(rows: Row[]): Result {
    if (this.singleMode === 'one') {
      if (rows.length !== 1) {
        return { data: null, error: { code: 'PGRST116', message: `JSON object requested, multiple (or no) rows returned` } }
      }
      return { data: rows[0], error: null }
    }
    if (this.singleMode === 'maybe') return { data: rows[0] ?? null, error: null }
    return { data: rows, error: null, count: this.wantCount ? rows.length : null }
  }

  execute(): Result {
    switch (this.op) {
      case 'select':
        return this.shape(this.matching())

      case 'insert': {
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
        const stored: Row[] = []
        for (const p of incoming) {
          const row = { id: randomUUID(), created_at: new Date().toISOString(), ...p }
          const err = this.uniqueViolation(row)
          if (err) return { data: null, error: err }
          this.db.rows(this.table).push(row)
          stored.push(row)
        }
        return this.returning ? this.shape(stored) : { data: null, error: null }
      }

      case 'update': {
        const rows = this.matching()
        for (const r of rows) {
          const next = { ...r, ...(this.payload as Row) }
          const err = this.uniqueViolation(next, r.id)
          if (err) return { data: null, error: err }
          Object.assign(r, this.payload)
        }
        return this.returning ? this.shape(rows) : { data: null, error: null }
      }

      case 'upsert': {
        const p = this.payload as Row
        const key = this.onConflict!
        const existing = p[key] != null ? this.db.rows(this.table).find(r => r[key] === p[key]) : undefined
        if (existing) {
          Object.assign(existing, p)
          return this.returning ? this.shape([existing]) : { data: null, error: null }
        }
        const row = { id: randomUUID(), created_at: new Date().toISOString(), ...p }
        const err = this.uniqueViolation(row)
        if (err) return { data: null, error: err }
        this.db.rows(this.table).push(row)
        return this.returning ? this.shape([row]) : { data: null, error: null }
      }

      case 'delete': {
        const rows = this.matching()
        const all = this.db.rows(this.table)
        for (const r of rows) all.splice(all.indexOf(r), 1)
        return { data: null, error: null }
      }
    }
  }

  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }
}

export interface FakeClientOptions {
  user?: FakeUser | null
  /** Force `.from(table)` to fail for a table, to simulate an outage or a missing migration. */
  failTable?: Record<string, PostgrestError>
  signedUploadUrl?: string | null
  /** Objects `storage.from(bucket).download(path)` can return, keyed by path (any bucket). Prefer db.putObject(). */
  storageObjects?: Record<string, string>
  /** Make every `storage.from(bucket).remove()` fail with this message. */
  storageRemoveError?: string
  /** Make `auth.admin.deleteUser()` fail with this message. */
  deleteUserError?: string
}

export function createFakeClient(db: FakeDb, opts: FakeClientOptions = {}) {
  const rpcCalls: { fn: string; args: unknown }[] = []
  const client = {
    rpcCalls,
    from(table: string) {
      const fail = opts.failTable?.[table]
      if (fail) {
        const failing = {
          then: (res: (v: Result) => unknown) => Promise.resolve({ data: null, error: fail }).then(res),
        }
        const proxy: Record<string, unknown> = {}
        for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'gte', 'lte', 'ilike', 'or', 'order', 'limit', 'range', 'maybeSingle', 'single']) {
          proxy[m] = () => proxy
        }
        proxy.then = failing.then
        return proxy as unknown as Builder
      }
      return new Builder(db, table)
    },
    async rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args })
      if (fn === 'increment_attempts') {
        const { user_id } = args as { user_id: string }
        const p = db.find('profiles', r => r.id === user_id)
        if (p) p.total_attempts = Number(p.total_attempts ?? 0) + 1
      }
      if (fn === 'admin_totals') {
        const bets = db.rows('bets')
        return { data: {
          total_revenue_cents: bets.reduce((s, b) => s + Number(b.stake_pence ?? 0), 0),
          total_payout_cents: bets.filter(b => b.status === 'paid').reduce((s, b) => s + Number(b.potential_win_pence ?? 0), 0),
          total_bets: bets.length,
          active_bets: bets.filter(b => b.status === 'active').length,
          pending_claims: db.rows('verifications').filter(v => ['pending', 'documents_received', 'under_review'].includes(String(v.status))).length,
          total_users: db.rows('profiles').length,
        }, error: null }
      }
      if (fn === 'admin_revenue_by_tier') {
        const byTier = new Map<string, { tier: string; bet_count: number; revenue_cents: number; payout_cents: number }>()
        for (const b of db.rows('bets')) {
          const t = byTier.get(String(b.tier)) ?? { tier: String(b.tier), bet_count: 0, revenue_cents: 0, payout_cents: 0 }
          t.bet_count++; t.revenue_cents += Number(b.stake_pence ?? 0)
          if (b.status === 'paid') t.payout_cents += Number(b.potential_win_pence ?? 0)
          byTier.set(t.tier, t)
        }
        return { data: [...byTier.values()], error: null }
      }
      if (fn === 'admin_revenue_by_course') {
        const byCourse = new Map<string, { course_id: string; course_name: string; bet_count: number; revenue_cents: number }>()
        for (const b of db.rows('bets')) {
          const id = String(b.course_id)
          const c = byCourse.get(id) ?? { course_id: id, course_name: String(db.find('courses', r => r.id === id)?.name ?? 'Unknown'), bet_count: 0, revenue_cents: 0 }
          c.bet_count++; c.revenue_cents += Number(b.stake_pence ?? 0)
          byCourse.set(id, c)
        }
        return { data: [...byCourse.values()].sort((a, b) => b.revenue_cents - a.revenue_cents), error: null }
      }
      if (fn === 'rate_limit_hit') {
        const { p_key, p_limit, p_window_seconds } = args as { p_key: string; p_limit: number; p_window_seconds: number }
        const now = Date.now()
        const rows = db.rows('rate_limits')
        let row = rows.find(r => r.key === p_key)
        if (!row || Number(row.window_start) + p_window_seconds * 1000 <= now) {
          if (row) rows.splice(rows.indexOf(row), 1)
          row = { key: p_key, count: 0, window_start: now }
          rows.push(row)
        }
        row.count = Number(row.count) + 1
        return {
          data: [{ allowed: Number(row.count) <= p_limit, remaining: Math.max(p_limit - Number(row.count), 0), reset_at: new Date(Number(row.window_start) + p_window_seconds * 1000).toISOString() }],
          error: null,
        }
      }
      return { data: null, error: null }
    },
    auth: {
      async getUser() {
        return { data: { user: opts.user ?? null }, error: opts.user ? null : { message: 'no session' } }
      },
      async getSession() {
        return { data: { session: opts.user ? { user: opts.user } : null }, error: null }
      },
      async exchangeCodeForSession(code: string) {
        return code === 'good-code' ? { data: {}, error: null } : { data: null, error: { message: 'invalid code' } }
      },
      async verifyOtp({ token_hash }: { token_hash: string }) {
        return token_hash === 'good-hash' ? { data: {}, error: null } : { data: null, error: { message: 'expired' } }
      },
      admin: {
        /** Mirrors the schema's cascades: profile and bets go (verifications with them); ledger rows keep their money and lose the person. */
        async deleteUser(id: string) {
          if (opts.deleteUserError) return { data: { user: null }, error: { message: opts.deleteUserError } }
          db.deletedUsers.push(id)
          const remove = (table: string, pred: (r: Row) => boolean) => {
            const rows = db.rows(table)
            const gone = rows.filter(pred)
            for (const g of gone) rows.splice(rows.indexOf(g), 1)
            return gone
          }
          remove('profiles', r => r.id === id)
          const betIds = new Set(remove('bets', r => r.user_id === id).map(b => b.id))
          remove('verifications', r => betIds.has(r.bet_id))
          for (const p of db.rows('payfast_payments')) {
            if (p.user_id === id) p.user_id = null
            if (betIds.has(p.bet_id)) p.bet_id = null
          }
          return { data: { user: null }, error: null }
        },
      },
    },
    storage: {
      from(bucket: string) {
        const objects = db.bucket(bucket)
        return {
          /** Direct children of `folder`: files carry an id, sub-folders come back with id null, like Supabase. */
          async list(folder: string, o: { limit?: number; offset?: number } = {}) {
            const prefix = folder.replace(/\/+$/, '') + '/'
            const files = new Map<string, { name: string; id: string | null }>()
            for (const path of objects.keys()) {
              if (!path.startsWith(prefix)) continue
              const rest = path.slice(prefix.length)
              const slash = rest.indexOf('/')
              if (slash === -1) files.set(rest, { name: rest, id: randomUUID() })
              else if (!files.has(rest.slice(0, slash))) files.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null })
            }
            const all = [...files.values()].sort((a, b) => a.name.localeCompare(b.name))
            const offset = o.offset ?? 0
            return { data: all.slice(offset, offset + (o.limit ?? 100)), error: null }
          },
          async remove(paths: string[]) {
            if (opts.storageRemoveError) return { data: null, error: { message: opts.storageRemoveError } }
            const removed: { name: string }[] = []
            for (const p of paths) if (objects.delete(p)) removed.push({ name: p })
            return { data: removed, error: null }
          },
          async createSignedUploadUrl(path: string) {
            if (opts.signedUploadUrl === null) return { data: null, error: { message: 'storage down' } }
            return { data: { signedUrl: opts.signedUploadUrl ?? `https://storage.example/upload/${path}`, path }, error: null }
          },
          async createSignedUrl(path: string) {
            return { data: { signedUrl: `https://storage.example/signed/${path}` }, error: null }
          },
          async download(path: string) {
            const obj = objects.get(path) ?? opts.storageObjects?.[path]
            if (obj === undefined) return { data: null, error: { message: 'Object not found' } }
            return { data: new Blob([obj]), error: null }
          },
        }
      },
    },
  }
  return client
}

export type FakeClient = ReturnType<typeof createFakeClient>

/** Build a `Request` the way Next hands one to a route handler. */
export function jsonRequest(url: string, body: unknown, init: RequestInit = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    body: JSON.stringify(body),
    ...init,
  })
}

export function formRequest(url: string, fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  })
}

export const USER_A: FakeUser = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com', user_metadata: { full_name: 'Alice Ace' } }
export const USER_B: FakeUser = { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.com' }
export const COURSE_ID = '33333333-3333-4333-8333-333333333333'
export const HOLE_ID = '44444444-4444-4444-8444-444444444444'
