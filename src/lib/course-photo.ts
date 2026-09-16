/**
 * Course photography for the select-course cards.
 *
 * Three sources, tried in order by the card (it moves to the next one when
 * an image fails to load):
 *
 *   1. Our own copy in public/marketing/courses/<slug>.jpg. Fast, cached by
 *      the service worker, never blocked. `npm run photos:fetch` downloads
 *      and resizes any REMOTE_PHOTOS entry that has no local copy yet.
 *   2. The original on satop100courses.com, used with permission. The
 *      browser loads it directly; slower and not cached by us, but it
 *      keeps the card illustrated until the local copy is committed.
 *   3. `courses.image_url` from the database (set in Admin → Courses).
 *
 * Matching is by a keyword in the course name, so "Zimbali Country Club"
 * and "Zimbali CC" both resolve.
 */

/** Courses with a committed photo: keyword in the name → file slug. */
export const LOCAL_PHOTOS: [keyword: string, slug: string][] = [
  ['atlantic beach', 'atlantic-beach'],
  ['bellville',      'bellville'],
  ['boschenmeer',    'boschenmeer'],
  ['centurion',      'centurion'],
  ['clovelly',       'clovelly'],
  ['durbanville',    'durbanville'],
  ['east london',    'east-london'],
  ['goose valley',   'goose-valley'],
  ['graceland',      'graceland'],
  ['highland gate',  'highland-gate'],
  ['killarney',      'killarney'],
  ['metropolitan',   'metropolitan'],
  ['mossel bay',     'mossel-bay'],
  ['paarl',          'paarl'],
  ['rondebosch',     'rondebosch'],
  ['st francis',     'st-francis-links'],
  ['state mines',    'state-mines'],
  ['umhlali',        'umhlali'],
  ['zimbali',        'zimbali'],
]

/**
 * Partner courses whose photo lives on satop100courses.com (used with
 * permission). Keyword → [file slug for the local copy, source URL].
 * Longer keywords first where one name contains another (the three
 * Fancourt courses, the two Sun City courses).
 */
export const REMOTE_PHOTOS: [keyword: string, slug: string, url: string][] = [
  ['arabella',       'arabella',             'https://satop100courses.com/wp-content/uploads/2019/09/Arabella.jpg'],
  ['the links',      'fancourt-links',       'https://satop100courses.com/wp-content/uploads/2019/10/fancoury-l.jpg'],
  ['montagu',        'fancourt-montagu',     'https://satop100courses.com/wp-content/uploads/2019/10/Montagu-Course-at-Fancourt.jpg'],
  ['outeniqua',      'fancourt-outeniqua',   'https://satop100courses.com/wp-content/uploads/2019/10/Outeniqua-Course-at-Fancourt.jpg'],
  ['leopard creek',  'leopard-creek',        'https://satop100courses.com/wp-content/uploads/2023/07/LC-01.jpg'],
  ['pearl valley',   'pearl-valley',         'https://satop100courses.com/wp-content/uploads/2022/03/PearlValley.jpg'],
  ['pinnacle point', 'pinnacle-point',       'https://satop100courses.com/wp-content/uploads/2019/08/pinnacle-point.jpg'],
  ['gary player',    'sun-city-gary-player', 'https://satop100courses.com/wp-content/uploads/2022/03/DJI_0031_gpcc17thC.jpg'],
  ['lost city',      'sun-city-lost-city',   'https://satop100courses.com/wp-content/uploads/2022/03/LostCity_918_MASTERHRB.jpg'],
  ['atlantic beach', 'atlantic-beach',       'https://satop100courses.com/wp-content/uploads/2019/09/Atl-beach-18th-p4-a.jpg'],
  ['zimbali',        'zimbali',              'https://satop100courses.com/wp-content/uploads/2019/09/zimbali14thpar3.jpg'],
]

const localPath = (slug: string) => `/marketing/courses/${slug}.jpg`

/** The committed photo for a course name, or null. */
export function localCoursePhoto(name: string): string | null {
  const n = name.toLowerCase()
  const hit = LOCAL_PHOTOS.find(([kw]) => n.includes(kw))
  return hit ? localPath(hit[1]) : null
}

/** The original photo on satop100courses.com for a course name, or null. */
export function remoteCoursePhoto(name: string): string | null {
  const n = name.toLowerCase()
  const hit = REMOTE_PHOTOS.find(([kw]) => n.includes(kw))
  return hit ? hit[2] : null
}

/**
 * Every source worth trying for a course, best first, no duplicates and no
 * blanks. The card walks this list on load errors.
 */
export function coursePhotoCandidates(name: string, dbUrl: string | null | undefined): string[] {
  const list = [localCoursePhoto(name), remoteCoursePhoto(name), dbUrl ?? null]
  return [...new Set(list.filter((u): u is string => !!u))]
}
