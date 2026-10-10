/**
 * The daily cap on free swings, and the pause switch (migration 038).
 *
 * Each account's one free swing is a real R10,000 prize with nothing
 * behind it, and nothing limited how many of them a day could hand out.
 * Now at most `daily_cap` a day (South African date), and a pause for when
 * something is wrong. The rule is the database's: a BEFORE INSERT trigger
 * on bets locks the one caps row, counts today's free swings, and refuses
 * with FREE_SWING_CAP or FREE_SWING_PAUSED. What is here reads the same
 * row for the screens and the admin, and maps the trigger's refusal to the
 * golfer's answer.
 *
 * FREE_SWING_PAUSED=on in the environment pauses free swings before the
 * database is asked anything, for the day the database is the problem.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { log } from '@/lib/observability/log'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

/** What the caps row says, and what has been taken against it today. */
export interface FreeSwingCapStatus {
  dailyCap: number
  paused: boolean
  usedToday: number
  /** Whether a free swing can be granted now: not paused, under the cap. */
  open: boolean
  updatedAt: string | null
}

/** The defaults migration 038 seeds; also what a database without the row is treated as. */
export const DEFAULT_DAILY_CAP = 500

/** The golfer's answer when the day's free swings are gone or paused. */
export const FREE_SWING_CAP_MESSAGE = 'Free swings are fully booked for today. Try again tomorrow.'

export type FreeSwingCapRefusal = 'FREE_SWING_CAP' | 'FREE_SWING_PAUSED'

/** The trigger's refusal, when that is what an insert error is. */
export function capRefusalFromDbError(err: { code?: string; message?: string } | null | undefined): FreeSwingCapRefusal | null {
  if (err?.code !== 'P0001') return null
  return err.message === 'FREE_SWING_CAP' || err.message === 'FREE_SWING_PAUSED' ? err.message : null
}

/** The environment kill switch: checked before the database. */
export function envPaused(env: { FREE_SWING_PAUSED?: string } = { FREE_SWING_PAUSED: process.env.FREE_SWING_PAUSED }): boolean {
  return env.FREE_SWING_PAUSED === 'on'
}

/** Midnight at the start of today in South Africa (+02:00 all year), as an ISO timestamp. */
export function southAfricanDayStart(now: number = Date.now()): string {
  const date = new Date(now + 2 * 3_600_000).toISOString().slice(0, 10)
  return new Date(`${date}T00:00:00+02:00`).toISOString()
}

/**
 * The caps row and today's count, read with the service role (the table is
 * closed to the public API). A database that has not reached migration 038
 * has no row and no trigger: reported as open at the default cap, with a
 * warning in the log, so the free swing works as it did.
 */
export async function readFreeSwingCap(admin: Client, now: number = Date.now()): Promise<FreeSwingCapStatus> {
  const [{ data: caps, error: capsError }, { count, error: countError }] = await Promise.all([
    admin.from('free_swing_caps').select('daily_cap, paused, updated_at').eq('id', 1).maybeSingle(),
    admin.from('bets').select('id', { count: 'exact', head: true }).eq('tier', 'tier_free').gte('created_at', southAfricanDayStart(now)),
  ])
  if (countError) throw countError
  if (capsError) {
    // 42P01: the table is not there yet. Anything else is a real failure.
    if (capsError.code === '42P01') log.warn('free_swing_cap.table_missing', { hint: 'run migration 038' })
    else throw capsError
  }
  const row = (caps ?? null) as { daily_cap: number; paused: boolean; updated_at: string } | null
  const dailyCap = row ? Number(row.daily_cap) : DEFAULT_DAILY_CAP
  const paused = Boolean(row?.paused)
  const usedToday = count ?? 0
  return { dailyCap, paused, usedToday, open: !paused && usedToday < dailyCap, updatedAt: row?.updated_at ?? null }
}
