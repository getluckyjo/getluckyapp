/**
 * GET /api/golf-days/[slug]/calendar
 * Returns: the golf day as an .ics calendar event (text/calendar)
 *
 * "Add to calendar" on an iPhone or a computer: Safari opens it straight
 * into its Add to Calendar sheet. Open to anyone with the link, like the
 * golf day screen, and it says no more than that screen does. Android adds
 * the same event through a Google Calendar link instead (src/lib/golf-days/calendar.ts).
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api/http'
import { siteUrl } from '@/lib/email/layout'
import { golfDayEvent, toIcs } from '@/lib/golf-days/calendar'
import { golfDayBySlug, holesFor } from '@/lib/golf-days/load'
import { parseLook } from '@/lib/golf-days/look'
import { GOLF_DAY_REFUSALS, GOLF_DAY_SLUG_PATTERN } from '@/lib/golf-days/rules'
import { themeFor } from '@/lib/golf-days/themes'

type Ctx = { params: Promise<{ slug: string }> }

const notFound = () => NextResponse.json(
  { error: GOLF_DAY_REFUSALS.GOLF_DAY_NOT_FOUND.error, code: 'GOLF_DAY_NOT_FOUND' },
  { status: 404 },
)

export async function GET(_request: Request, { params }: Ctx) {
  const { slug } = await params
  if (!GOLF_DAY_SLUG_PATTERN.test(slug)) return notFound()

  try {
    const admin = createAdminClient()
    const day = await golfDayBySlug(admin, slug)
    // A switched-off golf day is nothing to put in a diary.
    if (!day || day.disabled_at) return notFound()

    const holes = (await holesFor(admin, [day.id])).get(day.id) ?? []
    const event = golfDayEvent({
      slug: day.slug,
      name: day.name,
      tabLabel: day.tab_label,
      playsOn: day.plays_on,
      prizeZAR: Math.round(day.prize_pence / 100),
      holes,
    }, { site: siteUrl(), venue: themeFor(day.slug, parseLook(day.look)).venue })

    return new Response(toIcs(event, new Date()), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        // inline: an iPhone shows the event to add, rather than a file to save.
        'Content-Disposition': `inline; filename="${day.slug}.ics"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return apiError('golf_days.calendar_failed', err)
  }
}
