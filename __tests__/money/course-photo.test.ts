import { describe, it, expect } from 'vitest'
import { coursePhotoCandidates, localCoursePhoto, remoteCoursePhoto, LOCAL_PHOTOS, REMOTE_PHOTOS } from '@/lib/course-photo'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PARTNERS = [
  'Arabella Golf Club', 'Atlantic Beach Golf Estate', 'Fancourt – Montagu', 'Fancourt – Outeniqua',
  'Fancourt – The Links', 'Leopard Creek Country Club', 'Pearl Valley Golf Club', 'Pinnacle Point Golf Club',
  'Sun City – Gary Player CC', 'Sun City – The Lost City', 'Zimbali Country Club',
]

describe('course photos', () => {
  it('every partner course has at least one photo source', () => {
    for (const name of PARTNERS) {
      expect(coursePhotoCandidates(name, null).length, name).toBeGreaterThan(0)
    }
  })

  it('the three Fancourt and two Sun City courses resolve to different photos', () => {
    const urls = ['Fancourt – Montagu', 'Fancourt – Outeniqua', 'Fancourt – The Links', 'Sun City – Gary Player CC', 'Sun City – The Lost City']
      .map(n => remoteCoursePhoto(n))
    expect(new Set(urls).size).toBe(5)
  })

  it('prefers the committed copy, then the original, then the database URL, without duplicates', () => {
    expect(coursePhotoCandidates('Zimbali Country Club', 'https://x/db.jpg')).toEqual([
      '/marketing/courses/zimbali.jpg',
      'https://satop100courses.com/wp-content/uploads/2019/09/zimbali14thpar3.jpg',
      'https://x/db.jpg',
    ])
    expect(coursePhotoCandidates('Arabella Golf Club', null)).toEqual([
      'https://satop100courses.com/wp-content/uploads/2019/09/Arabella.jpg',
    ])
    expect(coursePhotoCandidates('Unknown Links', null)).toEqual([])
    expect(coursePhotoCandidates('Unknown Links', 'https://x/db.jpg')).toEqual(['https://x/db.jpg'])
    expect(localCoursePhoto('Paarl Golf Club')).toBe('/marketing/courses/paarl.jpg')
  })

  it('every LOCAL_PHOTOS entry points at a committed file, so a card never 404s into the fallback', () => {
    for (const [, slug] of LOCAL_PHOTOS) {
      expect(existsSync(join(process.cwd(), 'public', 'marketing', 'courses', `${slug}.jpg`)), slug).toBe(true)
    }
    for (const [, , url] of REMOTE_PHOTOS) expect(url.startsWith('https://')).toBe(true)
  })
})
