import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError, parseBody } from '@/lib/api/http'
import { RULES, enforceRateLimit, clientIp } from '@/lib/rate-limit'
import { enqueue } from '@/lib/outbox'
import { log } from '@/lib/observability/log'

const Body = z.object({
  message: z.string().trim().min(1).max(4000),
  route: z.string().trim().max(200).optional(),
  standalone: z.boolean().optional(),
  appVersion: z.string().trim().max(40).optional(),
  buildDate: z.string().trim().max(40).optional(),
  screen: z.string().trim().max(40).optional(),
})

/**
 * Beta feedback from the floating button. Stored with the context that
 * makes it actionable, then emailed to ops through the outbox so the
 * request never waits on Resend. Works signed out too: a tester stuck on
 * the sign-in screen is exactly who we want to hear from.
 */
export async function POST(request: Request) {
  const body = await parseBody(request, Body)
  if (!body.ok) return body.response

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const limited = await enforceRateLimit(RULES.feedback, { userId: user?.id ?? null, ip: clientIp(request) })
    if (limited) return limited

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('feedback')
      .insert({
        user_id: user?.id ?? null,
        message: body.data.message,
        route: body.data.route ?? null,
        user_agent: (request.headers.get('user-agent') ?? '').slice(0, 400) || null,
        standalone: body.data.standalone ?? null,
        app_version: body.data.appVersion ?? null,
        build_date: body.data.buildDate ?? null,
        screen: body.data.screen ?? null,
      })
      .select('id')
      .single()
    if (error) throw error

    await enqueue(admin, 'feedback_email', { feedbackId: data.id })
    log.info('feedback.received', { id: data.id, signed_in: !!user })
    return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
  } catch (err) {
    return apiError('feedback.unhandled', err)
  }
}
