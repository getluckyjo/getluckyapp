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
  /** The hole the Icons play for the prize. */
  holeName: 'the Get Lucky hole',
  /** The one question the screen asks. */
  question: 'Who holes it on the Get Lucky hole?',
  /** The R10 million hole-in-one prize, as three tiles: amount, how many, who. */
  prizeTotal: 'R10 million hole-in-one prize',
  prizes: [
    { amount: 'R1m', count: 3, who: 'Fans who backed the Icon' },
    { amount: 'R4m', count: 1, who: 'The Icon' },
    { amount: 'R3m', count: 1, who: 'A charity they support' },
  ],
  /** Under the "You're backing" card, with the Icon's name in front. */
  fanStake: 'holes it, you are in the draw for R1 million.',
  /** Small print under the prize card. */
  prizeTerms: 'T&Cs apply',
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
  /** Bar length, 0–100: this Icon's backers against the most-backed Icon's. */
  share: number
  /** Has the most backers (ties share it); false until anyone has picked. */
  isLeader: boolean
}

/**
 * Standings for the list. One pick per golfer, so the honest number is how
 * many golfers back each Icon, not a percentage: three picks would read as
 * "67%" and mislead. The bar is drawn against the leader so the favourite
 * is full width and the rest are in proportion.
 */
export function withStandings<T extends { votes: number }>(rows: T[]): (T & { share: number; isLeader: boolean })[] {
  const top = rows.reduce((m, r) => Math.max(m, r.votes), 0)
  return rows.map(r => ({
    ...r,
    share: top ? Math.round((r.votes / top) * 100) : 0,
    isLeader: top > 0 && r.votes === top,
  }))
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
