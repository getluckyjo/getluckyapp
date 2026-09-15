/**
 * The shared request/response helpers every route uses: structured 400s for
 * bad input, generic 500s with a request id for internal failures.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { parseBody, parseQuery, apiError, pagination, uuid, boolString, dateLike } from '@/lib/api/http'
import { jsonRequest } from '../helpers/fake-supabase'

afterEach(() => vi.restoreAllMocks())

describe('parseBody', () => {
  const Schema = z.object({ name: z.string().min(1), age: z.number().int().min(18) })

  it('returns typed data for a valid body', async () => {
    const r = await parseBody(jsonRequest('http://x', { name: 'Alice', age: 41 }), Schema)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toEqual({ name: 'Alice', age: 41 })
  })

  it('answers 400 INVALID_INPUT with per-field issues', async () => {
    const r = await parseBody(jsonRequest('http://x', { name: '', age: 'old' }), Schema)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(400)
    const body = await r.response.json()
    expect(body.code).toBe('INVALID_INPUT')
    expect(body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['age', 'name'])
  })

  it('answers 400 for a body that is not JSON', async () => {
    const r = await parseBody(new Request('http://x', { method: 'POST', body: 'not json' }), Schema)
    expect(r.ok).toBe(false)
    if (!r.ok) expect((await r.response.json()).error).toMatch(/JSON/)
  })

  it('strips unknown keys rather than letting them through', async () => {
    const r = await parseBody(jsonRequest('http://x', { name: 'A', age: 20, is_admin: true }), Schema)
    if (r.ok) expect(r.data).not.toHaveProperty('is_admin')
  })
})

describe('parseQuery', () => {
  const Schema = pagination.extend({ suspended: boolString.optional(), from: dateLike.optional(), id: uuid.optional() })

  it('applies defaults, coerces numbers and booleans, ignores empty values', () => {
    const r = parseQuery('http://x/api?page=2&suspended=true&from=2026-09-01&id=', Schema)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toEqual({ page: 2, limit: 20, suspended: true, from: '2026-09-01' })
  })

  it('caps limit, rejects page 0, bad dates and bad uuids', () => {
    for (const q of ['limit=500', 'page=0', 'from=yesterday', 'id=not-a-uuid', 'suspended=maybe']) {
      const r = parseQuery(`http://x/api?${q}`, Schema)
      expect(r.ok, q).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(400)
    }
  })
})

describe('apiError', () => {
  it('logs the real error with a request id and returns only a generic message and that id', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = apiError('test.failed', new Error('relation "secrets" does not exist'), { path: 'claim' })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('INTERNAL')
    expect(body.error).not.toMatch(/relation|secrets/)
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)
    const logged = spy.mock.calls.map(c => String(c[0])).join('\n')
    expect(logged).toContain('secrets')
    expect(logged).toContain('does not exist')
    expect(logged).toContain(body.requestId)
    expect(logged).toContain('"path":"claim"')
  })

  it('lets a route choose the client message and status without leaking the cause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = apiError('x', { message: 'internal detail' }, { status: 502, message: 'Upstream unavailable' })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('Upstream unavailable')
  })
})
