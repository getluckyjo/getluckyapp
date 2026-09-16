'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import { track } from '@/lib/analytics'
import { haptics } from '@/lib/haptics'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'
import { SearchIcon, GolfBallIcon } from '@/components/icons'
import { useBet } from '@/context/BetContext'
import type { Course, Hole } from '@/context/BetContext'
import { coursePhotoCandidates } from '@/lib/course-photo'
import { MIN_HOLE_METRES, holeUnavailableReason, isHolePlayable } from '@/lib/holes'

interface ApiHole {
  id: string
  hole_number: number
  par: number
  distance_metres: number | null
  /** Set by /api/courses; recomputed here so an older cached response still obeys the rule. */
  playable?: boolean
}

interface ApiCourse {
  id: string
  name: string
  location_text: string | null
  region: string | null
  country: string
  lat: number | null
  lng: number | null
  image_url: string | null
  is_partner: boolean
  holes: ApiHole[]
}

/** Chip that narrows the list to courses open for the challenge. */
const PARTNERS = 'Open to play'

/** Par 3 of MIN_HOLE_METRES or more; the only holes the challenge is played on. */
function playableHoles(c: ApiCourse): ApiHole[] {
  return c.holes.filter(isHolePlayable)
}

/** Open for play: an open course with at least one long-enough par 3. */
function isOpen(c: ApiCourse): boolean {
  return c.is_partner && playableHoles(c).length > 0
}

function toContextCourse(c: ApiCourse): Course {
  return {
    id: c.id,
    name: c.name,
    location: c.location_text ?? c.region ?? '',
    region: c.region ?? '',
    emoji: '⛳',
  }
}

function toContextHole(h: ApiHole, courseId: string): Hole {
  return {
    id: h.id,
    courseId,
    holeNumber: h.hole_number,
    par: h.par,
    distanceMetres: h.distance_metres ?? 0,
  }
}

/**
 * Our own course photo, else the original on satop100courses.com, else the
 * database's URL, else the brand-green tile. A source that fails to load
 * hands over to the next one instead of blanking the card.
 */
function CourseThumb({ name, src }: { name: string; src: string | null }) {
  const [failedCount, setFailedCount] = useState(0)
  const candidates = coursePhotoCandidates(name, src)
  const photo = candidates[failedCount]
  if (!photo) {
    return (
      <div className="cs-thumb" aria-hidden>
        <GolfBallIcon size={30} ball="rgba(255,255,255,0.9)" />
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={photo} src={photo} alt="" className="cs-thumb" loading="lazy" decoding="async" onError={() => setFailedCount(n => n + 1)} />
  )
}

/**
 * Select course — "Select Course Page.png".
 * SELECT COURSE, a white search bar, region chips (the active one lime with
 * the hard shadow), and a card per course: photo, name, town, and
 * "N x PAR3's | Hole n | 162m" with the distance repeated in a lime badge
 * pinned to the card's top-right corner.
 *
 * Tapping a card opens a small sheet above the tab bar to pick which par-3
 * (most courses have several) and continue to the stake.
 */
export default function SelectCoursePage() {
  const router = useRouter()
  const { selectCourse } = useBet()
  const [courses, setCourses] = useState<ApiCourse[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [selectedHoleId, setSelectedHoleId] = useState<string | null>(null)

  // Sets state only from the response callbacks, so the initial load can
  // run from an effect; the Retry button resets the flags itself first.
  function fetchCourses() {
    return fetch('/api/courses')
      .then(r => r.json())
      .then(data => {
        setCourses(data.courses ?? [])
        setLoading(false)
      })
      .catch(() => {
        setFetchError(true)
        setLoading(false)
      })
  }

  useEffect(() => { fetchCourses() }, [])

  function retry() {
    setLoading(true)
    setFetchError(false)
    fetchCourses()
  }

  // Regions ordered by how many courses they hold, so the busiest provinces
  // sit first in the chip row (the comp leads with Western Cape, Gauteng).
  const regionCounts = new Map<string, number>()
  for (const c of courses) {
    if (c.region) regionCounts.set(c.region, (regionCounts.get(c.region) ?? 0) + 1)
  }
  const hasComingSoon = courses.some(c => !isOpen(c))
  const regions = [
    'All',
    ...(hasComingSoon ? [PARTNERS] : []),
    ...Array.from(regionCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([r]) => r),
  ]

  const q = search.trim().toLowerCase()
  const filtered = courses.filter(c => {
    const matchesSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.location_text ?? '').toLowerCase().includes(q)
    const matchesFilter = filter === 'All' || (filter === PARTNERS ? isOpen(c) : c.region === filter)
    return matchesSearch && matchesFilter
  })

  const selectedCourse = courses.find(c => c.id === selectedCourseId)
  const selectedHole = selectedCourse?.holes.find(h => h.id === selectedHoleId)
    ?? (selectedCourse ? playableHoles(selectedCourse)[0] ?? selectedCourse.holes[0] : undefined)

  function handleSelectCourse(c: ApiCourse) {
    setSelectedCourseId(c.id)
    setSelectedHoleId((playableHoles(c)[0] ?? c.holes[0])?.id ?? null)
  }

  function handleContinue() {
    if (!selectedCourse || !selectedHole || !isOpen(selectedCourse) || !isHolePlayable(selectedHole)) return
    selectCourse(toContextCourse(selectedCourse), toContextHole(selectedHole, selectedCourse.id))
    haptics.tap()
    track('course_selected', { partner: selectedCourse.is_partner })
    router.push('/choose-stake')
  }

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="cs-head">
          <h1 className="v2-title cs-title">{'Select\nCourse'}</h1>

          <div className="cs-search">
            <span className="cs-search-icon"><SearchIcon size={20} /></span>
            <input
              type="search"
              placeholder="Search courses"
              aria-label="Search courses"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="cs-search-clear" aria-label="Clear search" onClick={() => setSearch('')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            )}
          </div>

          <div className="cs-chips" role="tablist" aria-label="Filter by region">
            {regions.map(r => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={filter === r}
                className={`cs-chip${filter === r ? ' is-active' : ''}`}
                onClick={() => setFilter(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className={`cs-list${selectedCourse ? ' cs-list--sheet-open' : ''}`}>
          {loading ? (
            [0, 1, 2, 3].map(i => (
              <div key={i} className="cs-card" style={{ pointerEvents: 'none' }}>
                <div className="skeleton cs-thumb" style={{ background: undefined }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="skeleton" style={{ height: 18, width: '60%' }} />
                  <div className="skeleton" style={{ height: 13, width: '75%' }} />
                  <div className="skeleton" style={{ height: 13, width: '65%' }} />
                </div>
              </div>
            ))
          ) : fetchError ? (
            <div className="cs-state">
              <h3>Couldn&apos;t load courses</h3>
              <p>Check your connection and try again.</p>
              <button type="button" className="btn-lime" onClick={retry}>Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="cs-state">
              <h3>No courses found</h3>
              <p>{search ? `Nothing matches “${search}”.` : 'Try another region.'}</p>
            </div>
          ) : (
            filtered.map((c, i) => {
              const open = isOpen(c)
              const playable = playableHoles(c)
              const first = playable[0] ?? c.holes[0]
              const n = playable.length
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`cs-card${selectedCourseId === c.id ? ' is-selected' : ''}${open ? '' : ' is-soon'}`}
                  style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                  onClick={e => {
                    handleSelectCourse(c)
                    // Bring the chosen card clear of the hole sheet that opens below.
                    e.currentTarget.scrollIntoView({ block: 'start', behavior: 'smooth' })
                  }}
                  aria-pressed={selectedCourseId === c.id}
                >
                  <CourseThumb name={c.name} src={c.image_url} />
                  <div className="cs-info">
                    <div className="cs-name">{c.name}</div>
                    <div className="cs-loc">{c.location_text ?? c.region}</div>
                    <div className="cs-meta">
                      {n} x PAR3{n === 1 ? '' : '’s'}
                      {first && <><i>|</i>Hole {first.hole_number}</>}
                      {first?.distance_metres && <><i>|</i>{first.distance_metres}m</>}
                    </div>
                  </div>
                  {!c.is_partner ? (
                    <span className="cs-badge cs-badge--soon">Coming soon</span>
                  ) : !open ? (
                    <span className="cs-badge cs-badge--soon">Under {MIN_HOLE_METRES}m</span>
                  ) : first?.distance_metres ? (
                    <span className="cs-badge" aria-hidden>
                      {first.distance_metres}<small>M</small>
                    </span>
                  ) : null}
                </button>
              )
            })
          )}
        </div>

        {selectedCourse && selectedHole && (
          <div className="cs-sheet" role="dialog" aria-label="Choose your par-3">
            <div className="cs-sheet-top">
              <div>
                <div className="cs-sheet-name">{selectedCourse.name}</div>
                <div className="cs-sheet-sub">
                  Hole {selectedHole.hole_number} · Par {selectedHole.par} · {selectedHole.distance_metres ?? '—'}m
                </div>
              </div>
              <button
                type="button"
                className="cs-sheet-close"
                aria-label="Clear selection"
                onClick={() => { setSelectedCourseId(null); setSelectedHoleId(null) }}
              >
                ×
              </button>
            </div>

            {!selectedCourse.is_partner ? (
              <p className="cs-soon-note">
                Not open for the challenge yet. We add partner courses all the time; pick one marked open to play today.
              </p>
            ) : !isOpen(selectedCourse) ? (
              <p className="cs-soon-note">
                The challenge is played on par 3s of {MIN_HOLE_METRES}m or more, and every par 3 here is shorter. Pick another course.
              </p>
            ) : null}

            {isOpen(selectedCourse) && selectedCourse.holes.length > 1 && (
              <div className="cs-holes" role="radiogroup" aria-label="Par-3 hole">
                {selectedCourse.holes.map(h => {
                  const reason = holeUnavailableReason(h)
                  return (
                    <button
                      key={h.id}
                      type="button"
                      role="radio"
                      aria-checked={selectedHole.id === h.id}
                      aria-disabled={reason !== null}
                      disabled={reason !== null}
                      className={`cs-hole${selectedHole.id === h.id ? ' is-active' : ''}`}
                      onClick={() => setSelectedHoleId(h.id)}
                    >
                      Hole {h.hole_number}
                      <small>{h.distance_metres ?? '—'}m{reason ? ` · ${reason.toLowerCase()}` : ''}</small>
                    </button>
                  )
                })}
              </div>
            )}

            {isOpen(selectedCourse) ? (
              <button type="button" className="btn-lime btn-lime--block" onClick={handleContinue}>
                Continue
              </button>
            ) : (
              <button type="button" className="btn-tile btn-tile--block" onClick={() => { setSelectedCourseId(null); setSelectedHoleId(null); setFilter(PARTNERS) }}>
                Show courses open to play
              </button>
            )}
          </div>
        )}

        <BottomTabBar active="play" />
      </div>
    </PhoneFrame>
  )
}
