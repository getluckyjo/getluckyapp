/**
 * The admin side of golf days: what a row in /admin/golf-days is made of,
 * and the fields a golf day is made and edited with. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { uuid } from '@/lib/api/http'
import { GOLF_DAY_SELECT, golfDayFacts, holesFor, type GolfDayRow } from './load'
import { LookSchema, parseLook } from './look'
import { formatPrize } from '@/lib/format'
import { PRIZE_CURRENCIES, PRIZE_MAX, TRIP_MAX_DAYS, addDays, golfDayPhase, type AdminGolfDay, type PrizeCurrency } from './rules'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

export { GOLF_DAY_SELECT }

/** A hole of a golf day, and on a trip the date of its round. */
export interface ScheduledHole { holeId: string; playsOn: string | null }

/** Fields a golf day can be edited by. The link (slug) is set once: it has been sent out. */
export const EditableFields = {
  name: z.string().trim().min(1).max(80),
  tabLabel: z.string().trim().min(1, 'The tab label cannot be empty').max(12, 'The tab label fits 12 characters'),
  playsOn: z.iso.date(),
  /** A trip's last day (migration 033); null for a golf day of one day. */
  endsOn: z.iso.date().nullable(),
  /** Whole rand, or whole dollars; the most is PRIZE_MAX for the currency (checked with it, by prizeProblem). */
  prize: z.coerce.number().int().min(1, 'The prize is at least 1').max(PRIZE_MAX.ZAR),
  currency: z.enum(PRIZE_CURRENCIES),
  maxPlayers: z.coerce.number().int().min(1).max(5000),
  /** One per course on a golf day; one a round on a trip (a trip can play two courses in a day). */
  holes: z.array(z.object({ holeId: uuid, playsOn: z.iso.date().nullable() }))
    .min(1, 'Pick at least one hole').max(12, 'A golf day takes 12 holes at most')
    .refine(list => new Set(list.map(h => h.holeId)).size === list.length, 'A hole is in the list twice'),
  note: z.string().trim().max(200).nullable(),
  /** The look (src/lib/golf-days/look.ts); null goes back to the code theme or the Get Lucky look. */
  look: LookSchema.nullable(),
}

/** Why this prize is too big for its currency, or null. */
export function prizeProblem(prize: number, currency: PrizeCurrency): string | null {
  return prize > PRIZE_MAX[currency] ? `The prize can be ${formatPrize(PRIZE_MAX[currency], currency)} at most.` : null
}

/**
 * Why these dates and holes do not make a golf day or a trip, or null. A
 * trip ends after it starts, within TRIP_MAX_DAYS, and every hole has the
 * date of its round inside the trip. A golf day of one day has no dates on
 * its holes (normalise them with forSchedule first).
 */
export function scheduleProblem(playsOn: string, endsOn: string | null, holes: ScheduledHole[]): string | null {
  if (endsOn === null) return null
  if (endsOn <= playsOn) return 'A trip ends after the day it starts. For one day, leave the last day empty.'
  if (endsOn > addDays(playsOn, TRIP_MAX_DAYS)) return `A trip runs ${TRIP_MAX_DAYS} days at most.`
  const undated = holes.find(h => !h.playsOn || h.playsOn < playsOn || h.playsOn > endsOn)
  if (undated) return 'Give every hole the date of its round, from the first day of the trip to the last.'
  return null
}

/** The holes as a golf day of this kind keeps them: no dates on a golf day of one day. */
export function forSchedule(endsOn: string | null, holes: ScheduledHole[]): ScheduledHole[] {
  return endsOn === null ? holes.map(h => ({ ...h, playsOn: null })) : holes
}

interface Usage { players: number; swings: number; claimed: number }

/** Every golf day asked for (all when `ids` is omitted), as the admin list shows them. */
export async function adminGolfDays(admin: Client, ids?: string[]): Promise<AdminGolfDay[]> {
  let query = admin.from('golf_days').select(GOLF_DAY_SELECT).order('plays_on', { ascending: false })
  if (ids) query = query.in('id', ids)
  const [{ data: days, error }, usage] = await Promise.all([query, admin.rpc('admin_golf_day_usage')])
  if (error) throw error
  if (usage.error) throw usage.error

  const rows = (days ?? []) as GolfDayRow[]
  const byDay = new Map<string, Usage>(
    ((usage.data ?? []) as { golf_day_id: string; players: unknown; swings: unknown; claimed: unknown }[])
      .map(u => [u.golf_day_id, { players: Number(u.players ?? 0), swings: Number(u.swings ?? 0), claimed: Number(u.claimed ?? 0) }]),
  )
  const holes = await holesFor(admin, rows.map(r => r.id))

  return rows.map(r => {
    const u = byDay.get(r.id)
    const facts = golfDayFacts(r)
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      tabLabel: r.tab_label,
      ...facts,
      maxPlayers: r.max_players,
      note: r.note,
      disabledAt: r.disabled_at,
      phase: golfDayPhase(facts.playsOn, Date.now(), facts.endsOn),
      players: u?.players ?? 0,
      swings: u?.swings ?? 0,
      claimed: u?.claimed ?? 0,
      holes: holes.get(r.id) ?? [],
      createdAt: r.created_at,
      look: parseLook(r.look),
    }
  })
}

/** The holes a golf day is played on now, with a trip round's date. */
export async function currentHoles(admin: Client, golfDayId: string): Promise<ScheduledHole[]> {
  // Every column: plays_on arrives with migration 033.
  const { data, error } = await admin.from('golf_day_holes').select('*').eq('golf_day_id', golfDayId)
  if (error) throw error
  return (data ?? []).map((h: { hole_id: string; plays_on?: string | null }) => ({ holeId: h.hole_id, playsOn: h.plays_on ?? null }))
}

/**
 * Point a golf day at exactly these holes, on these dates, given the ones
 * it has now.
 *
 * A diff, adding before removing: PostgREST gives no transaction across
 * the steps, and if a later one fails the day keeps holes to play (old and
 * new together) rather than none. A hole it keeps changes only its date,
 * and only when that changed.
 */
export async function setHoles(admin: Client, golfDayId: string, holes: ScheduledHole[], current: ScheduledHole[]): Promise<void> {
  const have = new Map(current.map(h => [h.holeId, h.playsOn]))
  const want = new Set(holes.map(h => h.holeId))
  const added = holes.filter(h => !have.has(h.holeId))
  const moved = holes.filter(h => have.has(h.holeId) && have.get(h.holeId) !== h.playsOn)
  const removed = current.filter(h => !want.has(h.holeId)).map(h => h.holeId)
  if (added.length) {
    // plays_on only when there is one, so a golf day of one day can be made before migration 033.
    const { error } = await admin.from('golf_day_holes')
      .insert(added.map(h => ({ golf_day_id: golfDayId, hole_id: h.holeId, ...(h.playsOn ? { plays_on: h.playsOn } : {}) })))
    if (error) throw error
  }
  for (const h of moved) {
    const { error } = await admin.from('golf_day_holes').update({ plays_on: h.playsOn }).eq('golf_day_id', golfDayId).eq('hole_id', h.holeId)
    if (error) throw error
  }
  if (removed.length) {
    const { error } = await admin.from('golf_day_holes').delete().eq('golf_day_id', golfDayId).in('hole_id', removed)
    if (error) throw error
  }
}
