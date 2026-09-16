/**
 * The hole rule: the challenge is played on par 3s of 140 m or more.
 * 140 m itself counts (Johannes, 16 September 2026).
 */
import { describe, it, expect } from 'vitest'
import { MIN_HOLE_METRES, isHolePlayable, holeUnavailableReason } from '@/lib/holes'

describe('isHolePlayable', () => {
  it('is 140 m', () => expect(MIN_HOLE_METRES).toBe(140))

  it('accepts a par 3 of 140 m or more', () => {
    expect(isHolePlayable({ par: 3, distance_metres: 140 })).toBe(true)
    expect(isHolePlayable({ par: 3, distance_metres: 230 })).toBe(true)
  })

  it('refuses a shorter par 3, any other par, and an unknown distance', () => {
    expect(isHolePlayable({ par: 3, distance_metres: 139 })).toBe(false)
    expect(isHolePlayable({ par: 4, distance_metres: 320 })).toBe(false)
    expect(isHolePlayable({ par: 3, distance_metres: null })).toBe(false)
  })

  it('says why', () => {
    expect(holeUnavailableReason({ par: 3, distance_metres: 140 })).toBeNull()
    expect(holeUnavailableReason({ par: 3, distance_metres: 98 })).toBe('Under 140m')
    expect(holeUnavailableReason({ par: 5, distance_metres: 480 })).toBe('Par 5')
    expect(holeUnavailableReason({ par: 3, distance_metres: null })).toBe('Distance not set')
  })
})
