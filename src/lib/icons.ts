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
  /** The one line under the hero: what to do, and what is in it for the fan. */
  intro: 'Vote for the Icon you think holes it on the Get Lucky hole. If they do, you are in the draw for one of three R1 million prizes.',
  /** The prize card's headline, the amount and what it is for on two lines. */
  prizeAmount: 'R10 million',
  prizeKind: 'Hole in one',
  /** For screen readers, and anywhere the prize needs one flat sentence. */
  prizeTotal: 'R10 million hole-in-one prize',
  /** The breakdown under the headline: amount, how many, who. */
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
 * How many picks the field needs before the counts are shown at all.
 *
 * A page of "0 backing" next to every name, with one early voter crowned
 * fan favourite off a single pick, reads as an empty room — and an empty
 * room is the best reason anyone has not to vote. Until the field gets
 * there the page shows the Icons and asks for a pick; the votes are
 * counted the whole time, they are just not on display.
 */
export const VOTE_REVEAL_THRESHOLD = 50

/** Are there enough picks for the counts to mean anything yet? */
export function shouldRevealVotes(totalVotes: number): boolean {
  return totalVotes >= VOTE_REVEAL_THRESHOLD
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

/**
 * Committed headshots, by Icon name. The Icons Series portraits, cut to the
 * head and set on the team colour, so an avatar is one small file from our
 * own origin rather than a hotlink to someone else's CDN.
 *
 * `icons.photo_url` (Admin → Icons) still wins when it is set; this is the
 * fallback, so a photo can be swapped without a deploy.
 */
const ICON_PHOTOS: Record<string, string> = {
  'ernie els':           'els',
  'josé maría olazábal': 'olazabal',
  'ab de villiers':      'de-villiers',
  'john terry':          'terry',
  'butch james':         'james',
  'vernon philander':    'philander',
  'fourie du preez':     'du-preez',
  'brian lara':          'lara',
  'ash barty':           'barty',
  'dwight yorke':        'yorke',
  'shaun pollock':       'pollock',
  'yuvraj singh':        'singh',
  'schalk burger':       'burger',
  'george gregan':       'gregan',
  'jimmy anderson':      'anderson',
  'victor matfield':     'matfield',
  'christian cullen':    'cullen',
  'roland schoeman':     'schoeman',
}

/** The committed headshot for an Icon, or null when we do not have one. */
export function iconPhoto(name: string): string | null {
  const slug = ICON_PHOTOS[name.trim().toLowerCase()]
  return slug ? `/marketing/icons/headshots/${slug}.webp` : null
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
