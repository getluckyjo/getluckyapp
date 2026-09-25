/**
 * The admin side of golf days: what a row in /admin/golf-days is made of,
 * and the fields a golf day is made and edited with. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { uuid } from '@/lib/api/http'
import { GOLF_DAY_SELECT, holesFor, type GolfDayRow } from './load'
import { LookSchema, parseLook } from './look'
import { golfDayPhase, type AdminGolfDay } from './rules'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

export { GOLF_DAY_SELECT }

/** Fields a golf day can be edited by. The link (slug) is set once: it has been sent out. */
export const EditableFields = {
  name: z.string().trim().min(1).max(80),
  tabLabel: z.string().trim().min(1, 'The tab label cannot be empty').max(12, 'The tab label fits 12 characters'),
  playsOn: z.iso.date(),
  prizeRand: z.coerce.number().int().min(1).max(1_000_000),
  maxPlayers: z.coerce.number().int().min(1).max(5000),
  holeIds: z.array(uuid).min(1, 'Pick at least one hole').max(6),
  note: z.string().trim().max(200).nullable(),
  /** The look (src/lib/golf-days/look.ts); null goes back to the code theme or the Get Lucky look. */
  look: LookSchema.nullable(),
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
  const officials = await coursesWithOfficials(admin, [...holes.values()].flat().map(h => h.course.id))

  return rows.map(r => {
    const u = byDay.get(r.id)
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      tabLabel: r.tab_label,
      playsOn: r.plays_on,
      prizeZAR: Math.round(r.prize_pence / 100),
      maxPlayers: r.max_players,
      note: r.note,
      disabledAt: r.disabled_at,
      phase: golfDayPhase(r.plays_on),
      players: u?.players ?? 0,
      swings: u?.swings ?? 0,
      claimed: u?.claimed ?? 0,
      holes: holes.get(r.id) ?? [],
      createdAt: r.created_at,
      look: parseLook(r.look),
      missingOfficials: [...new Map((holes.get(r.id) ?? []).map(h => [h.course.id, h.course.name])).entries()]
        .filter(([id]) => !officials.has(id)).map(([, name]) => name),
    }
  })
}

/** Which of these courses have a club official to confirm a claim by email (src/lib/claims/confirmation.ts). */
async function coursesWithOfficials(admin: Client, courseIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(courseIds)]
  if (!ids.length) return new Set()
  // Every contact of a course is asked to confirm, as confirmation.ts does.
  const { data, error } = await admin.from('course_contacts').select('course_id').in('course_id', ids)
  if (error) throw error
  return new Set((data ?? []).map((c: { course_id: string }) => c.course_id))
}

/** Point a golf day at exactly these holes. */
export async function setHoles(admin: Client, golfDayId: string, holeIds: string[]): Promise<void> {
  const { error: delError } = await admin.from('golf_day_holes').delete().eq('golf_day_id', golfDayId)
  if (delError) throw delError
  const { error } = await admin.from('golf_day_holes').insert([...new Set(holeIds)].map(hole_id => ({ golf_day_id: golfDayId, hole_id })))
  if (error) throw error
}
