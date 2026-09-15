import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { apiError, parseQuery } from '@/lib/api/http'

const Query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(20) })

export async function GET(request: Request) {
  try {
    const q = parseQuery(request.url, Query)
    if (!q.ok) return q.response
    const { limit } = q.data

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: bets, error } = await supabase
      .from('bets')
      .select(`
        id,
        tier,
        stake_pence,
        potential_win_pence,
        status,
        declared_result,
        created_at,
        courses (
          id,
          name,
          location_text,
          region
        ),
        holes (
          id,
          hole_number,
          par,
          distance_metres
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return NextResponse.json({ bets: bets ?? [] })
  } catch (err) {
    return apiError('bets.list_failed', err, { message: 'Could not load your bets.' })
  }
}
