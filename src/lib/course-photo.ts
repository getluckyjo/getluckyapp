/**
 * Local course photography for the select-course cards.
 *
 * The seed carries hotlinked photos from a third-party site; they are slow,
 * occasionally blocked, and never cached by us. For the courses we have our
 * own shots of, use those first. Matching is by a keyword in the course
 * name, so "Zimbali Country Club" and "Zimbali CC" both resolve.
 */
const LOCAL_PHOTOS: [keyword: string, file: string][] = [
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

export function localCoursePhoto(name: string): string | null {
  const n = name.toLowerCase()
  const hit = LOCAL_PHOTOS.find(([kw]) => n.includes(kw))
  return hit ? `/marketing/courses/${hit[1]}.jpg` : null
}
