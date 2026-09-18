/**
 * GET /api/admin/reports/free-swings
 *
 * Is the free swing paying for itself? Two questions, one answer:
 * how many are taken, and what share of those golfers stake real money
 * within seven days.
 *
 * The counting is SQL (migration 024, same pattern as the revenue
 * aggregates); the rates are worked out here, where they are tested.
 *
 * The seven-day rate is deliberately measured against `matured` — swings
 * old enough for their week to have closed — not against everyone who has
 * ever taken one. Counting yesterday's swing as "not converted" would make
 * the rate fall every time the free swing gets more popular, which is the
 * opposite of what the number is for. `pending` says how many are still
 * inside their week, so the denominator is never a mystery.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { apiError } from '@/lib/api/http'
import { FREE_TIER } from '@/lib/tiers'

interface Funnel {
  taken: number
  taken_7d: number
  taken_30d: number
  matured: number
  converted_7d: number
  converted_ever: number
  paid_bets_after_free: number
  revenue_after_free_cents: number
  claimed: number
  median_hours_to_first_paid: number | null
}

interface WeekRow { week_start: string; taken: number; matured: number; converted_7d: number }

/** Share as a percentage to one decimal, or null when nothing has matured yet. */
function rate(part: number, whole: number): string | null {
  if (whole <= 0) return null
  return ((part / whole) * 100).toFixed(1)
}

const num = (v: unknown) => Number(v ?? 0)

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error
  const admin = auth.adminClient

  try {
    const [funnelRes, weeksRes] = await Promise.all([
      admin.rpc('admin_free_swing_funnel'),
      admin.rpc('admin_free_swing_by_week'),
    ])
    if (funnelRes.error) throw funnelRes.error
    if (weeksRes.error) throw weeksRes.error

    const f = (funnelRes.data ?? {}) as Partial<Funnel>
    const taken = num(f.taken)
    const matured = num(f.matured)
    const converted7d = num(f.converted_7d)
    const convertedEver = num(f.converted_ever)
    const revenue = num(f.revenue_after_free_cents)
    const claimed = num(f.claimed)

    const weeks = ((weeksRes.data ?? []) as WeekRow[]).map(w => ({
      weekStart: w.week_start,
      taken: num(w.taken),
      matured: num(w.matured),
      converted: num(w.converted_7d),
      rate: rate(num(w.converted_7d), num(w.matured)),
    }))

    return NextResponse.json({
      taken,
      taken7d: num(f.taken_7d),
      taken30d: num(f.taken_30d),
      // The seven-day rate and exactly what it is a share of.
      matured,
      pending: Math.max(taken - matured, 0),
      converted7d,
      conversionRate7d: rate(converted7d, matured),
      // No window: everyone who came in free and has since staked anything.
      convertedEver,
      conversionRateEver: rate(convertedEver, taken),
      paidBetsAfterFree: num(f.paid_bets_after_free),
      revenueAfterFreeCents: revenue,
      // What one free swing has been worth in stakes so far. The other half
      // of the sum is what Indwe charges to cover it.
      revenuePerFreeSwingCents: taken > 0 ? Math.round(revenue / taken) : 0,
      medianHoursToFirstPaid: f.median_hours_to_first_paid == null ? null : Number(f.median_hours_to_first_paid),
      // Free swings that went in: the liability, and the review work.
      claimed,
      prizeExposureCents: claimed * FREE_TIER.winZAR * 100,
      weeks,
    })
  } catch (err) {
    return apiError('admin.reports.free_swings_failed', err, { path: 'admin_review' })
  }
}
