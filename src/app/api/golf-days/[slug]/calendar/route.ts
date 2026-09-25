/**
 * GET /api/golf-days/[slug]/calendar
 * Returns: the golf day as an .ics calendar file.
 *
 * "Add to my calendar" on the golf day screen, on iPhone and computers:
 * Safari opens it as an Add to Calendar sheet. The event carries the link,
 * so a player can always find their way back. Open to anyone, like the
 * golf day screen itself; it says nothing a signed-out visitor can't see.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api/http'
import { siteUrl } from '@/lib/email/layout'
import { golfDayBySlug, holesFor } from '@/lib/golf-days/load'
import { GOLF_DAY_REFUSALS, GOLF_DAY_SLUG_PATTERN } from '@/lib/golf-days/rules'
import { golfDayEvent, toIcs, venueOf } from '@/lib/golf-days/calendar'
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
    if (!day) return notFound()

    const holes = (await holesFor(admin, [day.id])).get(day.id) ?? []
    const event = golfDayEvent({
      slug: day.slug,
      name: day.name,
      tabLabel: day.tab_label,
      playsOn: day.plays_on,
      prizeZAR: Math.round(day.prize_pence / 100),
      holes,
    }, themeFor(day.slug).venue ?? venueOf(holes), siteUrl())

    return new NextResponse(toIcs(event), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `inline; filename="${day.slug}.ics"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return apiError('golf_days.calendar_failed', err)
  }
}
