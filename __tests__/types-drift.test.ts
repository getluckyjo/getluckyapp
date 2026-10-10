/**
 * src/types/database.ts is written by hand. A column added by migration and
 * forgotten there compiles fine and fails at runtime, so this test reads the
 * migrations the way a reviewer would and asks the types file two questions:
 *
 *   1. every `create table [if not exists] public.<name>` has a `<name>: {`
 *      block (the club funnel tables, which the app only reads, excepted);
 *   2. every `add column if not exists <col>` on a table is in that table's
 *      Row type.
 *
 * A regex over the SQL, nothing cleverer: tolerant of whitespace and case,
 * and of a column dropped again later (`drop column`). When it fails, the
 * fix is usually one line in src/types/database.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')
const TYPES = join(ROOT, 'src', 'types', 'database.ts')

/** Older club-funnel tables: read at most by email for a badge, never typed in full. */
const UNTYPED_TABLES = new Set(['members', 'payments', 'clubs', 'leads'])

function migrationsSql(): string {
  return readdirSync(MIGRATIONS)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n')
    // Strip line comments so a commented-out statement is not read as one.
    .replace(/--[^\n]*/g, '')
    .toLowerCase()
}

/** Table name → columns added by `alter table … add column if not exists`, minus any dropped later. */
function addedColumns(sql: string): Map<string, Set<string>> {
  const added = new Map<string, Set<string>>()
  const dropped = new Map<string, Set<string>>()
  for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)\s+([^;]*);/g)) {
    const [, table, body] = m
    for (const c of body.matchAll(/add\s+column\s+if\s+not\s+exists\s+(\w+)/g)) {
      if (!added.has(table)) added.set(table, new Set())
      added.get(table)!.add(c[1])
    }
    for (const c of body.matchAll(/drop\s+column\s+(?:if\s+exists\s+)?(\w+)/g)) {
      if (!dropped.has(table)) dropped.set(table, new Set())
      dropped.get(table)!.add(c[1])
    }
  }
  for (const [table, cols] of dropped) for (const c of cols) added.get(table)?.delete(c)
  return added
}

function createdTables(sql: string): string[] {
  return [...new Set([...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/g)].map(m => m[1]))]
}

/** The `Row: { … }` column names of one table block in database.ts, or null when the table has no block. */
function rowColumns(types: string, table: string): Set<string> | null {
  const start = types.search(new RegExp(`^ {6}${table}: \\{`, 'm'))
  if (start === -1) return null
  const rowAt = types.indexOf('Row: {', start)
  if (rowAt === -1) return new Set()
  // A Row block is one line (`Row: { a: string; b: number }`) or ends at the
  // first closing brace at its own indentation.
  const lineEnd = types.indexOf('\n', rowAt)
  const line = types.slice(rowAt, lineEnd)
  const end = line.includes('}') ? lineEnd : types.indexOf('\n        }', rowAt)
  const block = types.slice(rowAt, end === -1 ? undefined : end)
  const cols = new Set<string>()
  for (const m of block.matchAll(/(?:^|[{;])\s*(\w+)\??:/gm)) if (m[1] !== 'Row') cols.add(m[1])
  return cols
}

describe('src/types/database.ts keeps up with supabase/migrations', () => {
  const sql = migrationsSql()
  const types = readFileSync(TYPES, 'utf8')

  it('has a block for every table the migrations create', () => {
    const missing = createdTables(sql).filter(t => !UNTYPED_TABLES.has(t) && rowColumns(types, t) === null)
    expect(missing, `tables created by a migration but not typed: ${missing.join(', ')}`).toEqual([])
  })

  it('has every column the migrations add in that table\'s Row type', () => {
    const missing: string[] = []
    for (const [table, cols] of addedColumns(sql)) {
      if (UNTYPED_TABLES.has(table)) continue
      const row = rowColumns(types, table)
      if (row === null) continue // reported by the test above
      for (const c of cols) if (!row.has(c)) missing.push(`${table}.${c}`)
    }
    expect(missing, `columns added by a migration but not in the Row type: ${missing.join(', ')}`).toEqual([])
  })

  it('reads the migrations it checks (a guard against the regexes going quiet)', () => {
    expect(createdTables(sql)).toContain('bets')
    expect(addedColumns(sql).get('bets')).toContain('payout_approved_by')
    expect(rowColumns(types, 'bets')).toContain('payout_approved_by')
  })
})
