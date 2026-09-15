import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Mock AI verification — swap with real computer vision when ready
export async function POST(request: NextRequest) {
  try {
    const { betId, storagePath } = await request.json()

    // Simulate AI processing time (1.5–2.5s)
    const delay = 1500 + Math.random() * 1000
    await new Promise(r => setTimeout(r, delay))

    // Mock result — always returns "not verified" so user must self-declare
    // In production this would analyze the video for ball trajectory
    const result = {
      verified: false,
      confidence: 0.0,
      message: 'Manual review required — declare your result below',
      betId,
      storagePath,
      analysedAt: new Date().toISOString(),
    }

    // Save video URL to the bet — verification record is only created
    // when the user actually claims a hole-in-one (POST /api/verifications/[betId])
    try {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (user && betId && !betId.startsWith('bet_mock') && !betId.startsWith('bet_fallback')) {
        // Only a path inside the caller's own folder for this bet may be
        // attached, and only after RLS confirms the bet is theirs.
        const ownPrefix = `${user.id}/${betId}/`
        if (typeof storagePath === 'string' && storagePath.startsWith(ownPrefix) && !storagePath.includes('..')) {
          const { data: bet } = await supabase.from('bets').select('id').eq('id', betId).eq('user_id', user.id).maybeSingle()
          if (bet) {
            await createAdminClient().from('bets')
              .update({ video_url: storagePath })
              .eq('id', betId)
              .eq('user_id', user.id)
          }
        }
      }
    } catch {
      // Non-critical — continue
    }

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
