import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { RULES, clientIp, enforceRateLimit } from '@/lib/rate-limit'
import { apiError, parseBody } from '@/lib/api/http'
import { lookupToken, recordAnswer } from '@/lib/claims/confirmation'

type Params = { params: Promise<{ token: string }> }

/**
 * The public witness endpoint. No session: the token in the URL is the
 * credential, and it works once. Rate limited by IP. Answers with the
 * least it can: a first name, a course, a hole, a date.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const limited = await enforceRateLimit(RULES.witness, { ip: clientIp(request) })
  if (limited) return limited
  try {
    const { token } = await params
    const found = await lookupToken(createAdminClient(), token)
    if (!found.ok) return NextResponse.json({ ok: false, reason: found.reason }, { status: found.reason === 'not_found' ? 404 : 410 })
    return NextResponse.json({ ok: true, role: found.witness.role, witnessName: found.witness.name, ...found.ctx })
  } catch (err) {
    return apiError('witness.lookup_unhandled', err, { path: 'claim' })
  }
}

const Body = z.object({
  answer: z.enum(['yes', 'no']),
  note: z.string().trim().max(500).optional(),
})

export async function POST(request: NextRequest, { params }: Params) {
  const limited = await enforceRateLimit(RULES.witness, { ip: clientIp(request) })
  if (limited) return limited
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response
  try {
    const { token } = await params
    const result = await recordAnswer(createAdminClient(), token, {
      response: body.data.answer === 'yes' ? 'confirmed' : 'denied',
      note: body.data.note,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason }, { status: result.reason === 'not_found' ? 404 : 410 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError('witness.answer_unhandled', err, { path: 'claim' })
  }
}
