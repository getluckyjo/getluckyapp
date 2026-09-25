/**
 * The bets list's filters, shared with the CSV export so the file an admin
 * downloads holds the bets the page shows.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { searchTerm, uuid } from '@/lib/api/http'
import { orSearchTerm } from '@/lib/admin/data'
import { BET_STATUSES } from '@/lib/claims/state-machine'
import { ALL_TIERS } from '@/lib/tiers'

export const betFilters = {
  status: z.enum(BET_STATUSES).optional(),
  tier: z.enum(ALL_TIERS.map(t => t.tier) as [string, ...string[]]).optional(),
  search: searchTerm.optional(),
}

/**
 * A search as `.or()` conditions on bets: player names, emails and course
 * names resolved to ids first (so the count and the pages are right), plus an
 * exact bet id. An empty list means nothing can match. A failed lookup
 * throws: "no bets" must never stand in for "could not search".
 */
export async function betSearchConditions(admin: SupabaseClient, search: string): Promise<string[]> {
  const s = orSearchTerm(search)
  const [users, courses] = await Promise.all([
    admin.from('profiles').select('id').or(`name.ilike.*${s}*,email.ilike.*${s}*`).limit(100),
    admin.from('courses').select('id').ilike('name', `%${search}%`).limit(50),
  ])
  if (users.error) throw users.error
  if (courses.error) throw courses.error
  const conds: string[] = []
  if (uuid.safeParse(search).success) conds.push(`id.eq.${search}`)
  const userIds = ((users.data ?? []) as { id: string }[]).map(u => u.id)
  const courseIds = ((courses.data ?? []) as { id: string }[]).map(c => c.id)
  if (userIds.length) conds.push(`user_id.in.(${userIds.join(',')})`)
  if (courseIds.length) conds.push(`course_id.in.(${courseIds.join(',')})`)
  return conds
}
