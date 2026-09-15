import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SA_TOP_100_COURSES } from '@/data/south-africa-courses'

// Build a lookup of image URLs from seed data keyed by course name
const SEED_IMAGE_MAP = new Map(
  SA_TOP_100_COURSES.map(c => [c.name, c.image_url])
)

// Convert seed data to the API shape expected by the client
const FALLBACK_COURSES = SA_TOP_100_COURSES.map(c => ({
  id: c.id,
  name: c.name,
  location_text: c.location_text,
  region: c.region,
  country: c.country,
  lat: c.lat,
  lng: c.lng,
  image_url: c.image_url,
  is_partner: c.is_partner,
  holes: c.holes,
}))

// Cache courses for 5 min, serve stale for 24h while revalidating
const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
}

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: courses, error } = await supabase
      .from('courses')
      .select('*, holes(id, hole_number, par, distance_metres)')
      .eq('is_partner', true)
      .eq('holes.is_active', true)
      .order('name')

    // Use DB courses when available, merging image URLs from seed data
    if (!error && courses && courses.length > 0) {
      const enriched = courses.map(c => ({
        ...c,
        image_url: c.image_url ?? SEED_IMAGE_MAP.get(c.name) ?? null,
      }))
      return NextResponse.json({ courses: enriched, source: 'database' }, { headers: CACHE_HEADERS })
    }

    return NextResponse.json({ courses: FALLBACK_COURSES, source: 'seed' }, { headers: CACHE_HEADERS })
  } catch {
    return NextResponse.json({ courses: FALLBACK_COURSES, source: 'seed' }, { headers: CACHE_HEADERS })
  }
}
