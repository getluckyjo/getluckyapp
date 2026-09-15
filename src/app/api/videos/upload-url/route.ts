import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { log } from '@/lib/observability/log'

export async function POST(request: NextRequest) {
  try {
    const { betId, mimeType = 'video/webm' } = await request.json()

    if (!betId) {
      return NextResponse.json({ error: 'betId required' }, { status: 400 })
    }

    // If Supabase not configured, return mock
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    if (supabaseUrl.includes('YOUR_PROJECT_REF')) {
      return NextResponse.json({
        signedUrl: null,
        storagePath: `mock/${betId}/shot.webm`,
        source: 'mock',
      })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify bet belongs to the current user (prevent IDOR)
    const { data: bet } = await supabase
      .from('bets')
      .select('id')
      .eq('id', betId)
      .eq('user_id', user.id)
      .single()

    if (!bet) {
      return NextResponse.json({ error: 'Bet not found or not yours' }, { status: 403 })
    }

    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
    const storagePath = `${user.id}/${betId}/shot.${ext}`

    const { data, error } = await supabase.storage
      .from('shot-videos')
      .createSignedUploadUrl(storagePath)

    if (error) {
      log.error('claim.upload_url_failed', error, { path: 'claim', user_id: user.id, bet_id: betId })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      signedUrl: data.signedUrl,
      storagePath,
      source: 'supabase',
    })
  } catch (err) {
    log.error('claim.upload_url_unhandled', err, { path: 'claim' })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
