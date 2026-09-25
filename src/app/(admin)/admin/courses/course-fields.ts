/**
 * What the course pages share: the regions a course can be in, the
 * coordinate check, and turning an API refusal into a sentence.
 */

export const REGIONS = ['Western Cape', 'Gauteng', 'KwaZulu-Natal', 'Mpumalanga', 'North West', 'Eastern Cape', 'Free State', 'Limpopo', 'Northern Cape']

/**
 * Latitude and longitude typed as text, checked together: both numbers in
 * range, or both empty. parseFloat would read "-33,9" as -33 and "abc" as
 * nothing at all, and a latitude without a longitude places nothing.
 */
export function parseCoords(latText: string, lngText: string): { ok: true; lat: number | null; lng: number | null } | { ok: false; error: string } {
  const lat = latText.trim() === '' ? null : Number(latText.trim())
  const lng = lngText.trim() === '' ? null : Number(lngText.trim())
  if ((lat === null) !== (lng === null)) return { ok: false, error: 'Fill in both latitude and longitude, or leave both empty.' }
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) return { ok: false, error: 'Latitude must be a number from -90 to 90, with a dot for decimals (-33.96).' }
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) return { ok: false, error: 'Longitude must be a number from -180 to 180, with a dot for decimals (22.38).' }
  return { ok: true, lat, lng }
}

const FIELD_LABELS: Record<string, string> = {
  hole_number: 'Hole number',
  par: 'Par',
  distance_metres: 'Distance',
  name: 'Name',
  email: 'Email',
  lat: 'Latitude',
  lng: 'Longitude',
}

/** The API's reason for a refusal, naming the field when the body failed its schema. */
export function reasonFrom(json: { error?: string; issues?: { path: string; message: string }[] }, fallback: string): string {
  const issue = json.issues?.[0]
  if (issue && FIELD_LABELS[issue.path]) return `${FIELD_LABELS[issue.path]}: ${issue.message}`
  return json.error ?? fallback
}

export const OFFLINE = 'Could not reach the server. Check your connection and try again.'
