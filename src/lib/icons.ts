/**
 * Back an Icon: the fan pick for Icons Cup South Africa.
 *
 * Get Lucky sponsors the event. It is public (icons-series.com), so the
 * app names it, shows the field by team and marks the captains. The prize
 * copy below was approved by Johannes on 16 September 2026; every word of
 * it lives here so it can be changed in one place. The field itself is
 * data, managed at /admin/icons.
 */
export const ICONS_EVENT = {
  name: 'Icons Cup South Africa',
  format: 'South Africa vs World',
  venue: 'The Links at Fancourt',
  dates: '11–13 December 2026',
  /** The headline on the prize card. */
  prizeHeadline: 'R10 million hole-in-one prize',
  /** What backing an Icon can mean for the golfer. */
  fanPrizeLine: 'A hole-in-one from your choice could win you R1 million.',
  /** Small print under the prize card. */
  prizeTerms: 'Terms and conditions apply.',
  sponsorLine: 'Get Lucky is a proud sponsor of Icons Cup South Africa.',
  hero: '/marketing/icons/launch.webp',
} as const

export type IconTeam = 'rsa' | 'world'

export const TEAM_LABEL: Record<IconTeam, string> = {
  rsa: 'Team South Africa',
  world: 'Team World',
}

export interface PublicIcon {
  id: string
  name: string
  team: IconTeam
  isCaptain: boolean
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

/** Team South Africa first, captain at the top of each team, then the admin's order. */
export function sortIcons<T extends { team: IconTeam; isCaptain: boolean; sortOrder: number; name: string }>(rows: T[]): T[] {
  const teamRank: Record<IconTeam, number> = { rsa: 0, world: 1 }
  return [...rows].sort((a, b) =>
    teamRank[a.team] - teamRank[b.team]
    || Number(b.isCaptain) - Number(a.isCaptain)
    || a.sortOrder - b.sortOrder
    || a.name.localeCompare(b.name),
  )
}
