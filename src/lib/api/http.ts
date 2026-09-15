/**
 * One way to read input and one way to fail, for every route handler.
 *
 *   const body = await parseBody(request, Schema)
 *   if (!body.ok) return body.response          // 400 INVALID_INPUT with issues
 *   …
 *   } catch (err) {
 *     return apiError('bets.create.unhandled', err, { path: 'bets_create' })   // 500, logged, request id
 *   }
 *
 * Nothing from an internal error object ever reaches the client: the response
 * carries a request id, and the log line and Sentry event carry the same id
 * so support can find what happened.
 */
import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z, type ZodType } from 'zod'
import { log, type MoneyPath } from '@/lib/observability/log'

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse }

export interface Issue { path: string; message: string }

export function issuesOf(error: z.ZodError): Issue[] {
  return error.issues.map(i => ({ path: i.path.map(String).join('.') || '(body)', message: i.message }))
}

export function invalidInput(issues: Issue[] | string, status = 400): NextResponse {
  const list = typeof issues === 'string' ? [{ path: '(body)', message: issues }] : issues
  return NextResponse.json(
    { error: list[0]?.message ?? 'Invalid request', code: 'INVALID_INPUT', issues: list },
    { status },
  )
}

/** Parse a JSON body against a schema. Non-JSON or non-object bodies are a 400 too. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, response: invalidInput('Request body must be JSON') }
  }
  const result = schema.safeParse(raw)
  if (!result.success) return { ok: false, response: invalidInput(issuesOf(result.error)) }
  return { ok: true, data: result.data }
}

/** Parse URL search params against a schema (values arrive as strings; use z.coerce for numbers). */
export function parseQuery<T>(url: string | URL, schema: ZodType<T>): Parsed<T> {
  const params: Record<string, string> = {}
  for (const [k, v] of new URL(url).searchParams) if (v !== '') params[k] = v
  const result = schema.safeParse(params)
  if (!result.success) return { ok: false, response: invalidInput(issuesOf(result.error)) }
  return { ok: true, data: result.data }
}

export interface ApiErrorOptions {
  path?: MoneyPath
  status?: number
  /** Client-facing message. Never derived from the error. */
  message?: string
  fields?: Record<string, unknown>
}

/** Log (and capture) an internal failure, answer with a generic message and a request id. */
export function apiError(event: string, err: unknown, opts: ApiErrorOptions = {}): NextResponse {
  const requestId = randomUUID()
  log.error(event, err, { ...(opts.fields ?? {}), path: opts.path, request_id: requestId })
  return NextResponse.json(
    { error: opts.message ?? 'Something went wrong. Please try again.', code: 'INTERNAL', requestId },
    { status: opts.status ?? 500 },
  )
}

// ── Schemas shared across routes ────────────────────────────────────────

export const uuid = z.uuid()

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const boolString = z.enum(['true', 'false']).transform(v => v === 'true')

/** A date or timestamp string a Postgres comparison will accept. */
export const dateLike = z.string().max(40).refine(s => !Number.isNaN(Date.parse(s)), 'Invalid date')

export const searchTerm = z.string().trim().min(1).max(100)
