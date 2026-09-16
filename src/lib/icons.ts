/**
 * Back an Icon: the fan pick for Icons Cup South Africa.
 *
 * The event details live here, in one place, so the copy can change without
 * touching the screen. Nothing about prizes is stated anywhere in the app:
 * the proposal is confidential and no prize is announced before cover is
 * confirmed in writing. The field (the Icons themselves) is data, managed
 * at /admin/icons.
 */
export const ICONS_EVENT = {
  name: 'Icons Cup South Africa',
  venue: 'The Links at Fancourt',
  dates: '11–13 December 2026',
} as const

export interface PublicIcon {
  id: string
  name: string
  tagline: string | null
  photoUrl: string | null
  votes: number
  /** Share of all picks, 0–100, rounded; 0 when nobody has picked yet. */
  percent: number
}

/** Rounded shares that still add up sensibly for a bar per Icon. */
export function withShares<T extends { votes: number }>(rows: T[]): (T & { percent: number })[] {
  const total = rows.reduce((s, r) => s + r.votes, 0)
  return rows.map(r => ({ ...r, percent: total ? Math.round((r.votes / total) * 100) : 0 }))
}

/** Initials for the avatar when an Icon has no photo: "Ernie Els" → "EE". */
export function iconInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
