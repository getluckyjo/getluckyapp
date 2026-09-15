'use client'

import { useRouter } from 'next/navigation'
import { HomeIcon, WinnersIcon, GolfBallIcon, ClubIcon, AccountIcon } from '@/components/icons'

export type ActiveTab = 'home' | 'history' | 'leaderboard' | 'membership' | 'account' | 'play'

/**
 * V2 tab bar — "Menu Bar Complete.svg".
 *
 * A soft grey pill holds five icons; the Play slot is a lime disc carrying the
 * golf ball, and it overhangs the pill top and bottom. Labels sit underneath
 * on a white band. The pill floats over whatever the screen has behind it
 * (a photo on Home, the grey surface elsewhere) — only the label band is
 * opaque, which is how the mockups draw it.
 */
const TABS = [
  { key: 'home',        label: 'Home',    path: '/home',          Icon: HomeIcon    },
  { key: 'leaderboard', label: 'Winners', path: '/leaderboard',   Icon: WinnersIcon },
  { key: 'play',        label: 'Play',    path: '/select-course', Icon: null        },
  { key: 'membership',  label: 'Club',    path: '/membership',    Icon: ClubIcon    },
  { key: 'account',     label: 'Account', path: '/account',       Icon: AccountIcon },
] as const

/** `active` may be omitted on pages that belong to no tab (legal, not found). */
export default function BottomTabBar({ active }: { active?: ActiveTab }) {
  const router = useRouter()

  return (
    <nav className="tabbar" aria-label="Main navigation">
      <div className="tabbar-pill" role="tablist">
        {TABS.map(tab => {
          const isActive = active === tab.key
          const isPlay = tab.key === 'play'
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.label}
              className={`tabbar-slot${isPlay ? ' tabbar-slot--play' : ''}${isActive ? ' is-active' : ''}`}
              onClick={() => !isActive && router.push(tab.path)}
            >
              {isPlay ? (
                <span className="tabbar-play" aria-hidden="true">
                  <GolfBallIcon size={40} />
                </span>
              ) : (
                tab.Icon && <tab.Icon size={tab.key === 'leaderboard' ? 27 : 24} />
              )}
            </button>
          )
        })}
      </div>
      <div className="tabbar-labels" aria-hidden="true">
        {TABS.map(tab => (
          <span
            key={tab.key}
            className={`tabbar-label${active === tab.key ? ' is-active' : ''}`}
          >
            {tab.label}
          </span>
        ))}
      </div>
    </nav>
  )
}
