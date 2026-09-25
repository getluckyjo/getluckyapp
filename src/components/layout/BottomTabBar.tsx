'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { haptics } from '@/lib/haptics'
import { HomeIcon, WinnersIcon, GolfBallIcon, ClubIcon, AccountIcon, FlagIcon, BombSquadIcon } from '@/components/icons'
import { useGolfDayTab } from '@/hooks/useGolfDayTab'
import { golfDayPath } from '@/lib/golf-days/rules'

export type ActiveTab = 'home' | 'history' | 'leaderboard' | 'icons' | 'golfday' | 'account' | 'play'

/**
 * V2 tab bar — "Menu Bar Complete.svg" (design/00-reference).
 *
 * A soft grey pill holds five icons; the Play slot is a lime disc carrying the
 * golf ball, and it overhangs the pill top and bottom (a little more below,
 * as the comp draws it). Labels sit underneath on a white band, in the
 * display face. Each tab is ONE button spanning its icon and its label, so a
 * tap on either works; the pill and the band are backgrounds behind them.
 *
 * Proportions come from the SVG: pill 672×94 with 14.2 corners (15% of the
 * height), disc diameter 1.48× the pill height, icons 40–49 tall in a 94
 * pill. At the app's 48px pill that is a 7px radius, a 71px disc and
 * 21–25px icons.
 */
interface Tab {
  key: ActiveTab
  label: string
  path: string
  Icon: typeof HomeIcon | null
  size: number
}

const TABS: Tab[] = [
  { key: 'home',        label: 'Home',    path: '/home',          Icon: HomeIcon,    size: 21 },
  { key: 'leaderboard', label: 'Winners', path: '/leaderboard',   Icon: WinnersIcon, size: 25 },
  { key: 'play',        label: 'Play',    path: '/select-course', Icon: null,        size: 0  },
  { key: 'icons',       label: 'Icons',   path: '/icons',         Icon: ClubIcon,    size: 21 },
  { key: 'account',     label: 'Account', path: '/account',       Icon: AccountIcon, size: 22 },
]

/** A golf day's tab shows its host's mark where there is one, keyed by slug; a pin flag otherwise. */
const GOLF_DAY_ICONS: Record<string, Pick<Tab, 'Icon' | 'size'>> = {
  bombsquad: { Icon: BombSquadIcon, size: 27 },
}
const GOLF_DAY_ICON_DEFAULT: Pick<Tab, 'Icon' | 'size'> = { Icon: FlagIcon, size: 22 }

/** `active` may be omitted on pages that belong to no tab (legal, not found). */
export default function BottomTabBar({ active }: { active?: ActiveTab }) {
  const router = useRouter()
  // A player who joined a golf day through its link sees it where Icons is;
  // everyone else, signed out included, keeps Icons.
  const golfDay = useGolfDayTab()
  const tabs = golfDay
    ? TABS.map(t => t.key !== 'icons' ? t : {
        key: 'golfday' as const, label: golfDay.tabLabel, path: golfDayPath(golfDay.slug),
        ...(GOLF_DAY_ICONS[golfDay.slug] ?? GOLF_DAY_ICON_DEFAULT),
      })
    : TABS
  const paths = tabs.map(t => t.path).join('|')

  // The five destinations are one tap away; have their code and route tree
  // ready before the tap so a switch feels instant.
  useEffect(() => {
    for (const path of paths.split('|')) router.prefetch(path)
  }, [router, paths])

  function go(path: string) {
    haptics.tap()
    router.push(path)
  }

  return (
    <nav className="tabbar" aria-label="Main navigation">
      <div className="tabbar-band" aria-hidden="true" />
      <div className="tabbar-pill" aria-hidden="true" />
      <div className="tabbar-tabs" role="tablist">
        {tabs.map(tab => {
          const isActive = active === tab.key
          const isPlay = tab.key === 'play'
          // A golf day's label ("Bomb Squad") runs longer than the built-in five.
          const isLong = tab.label.length > 7
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? 'page' : undefined}
              className={`tabbar-tab${isPlay ? ' tabbar-tab--play' : ''}${isLong ? ' tabbar-tab--long' : ''}${isActive ? ' is-active' : ''}`}
              onClick={() => !isActive && go(tab.path)}
            >
              <span className="tabbar-slot" aria-hidden="true">
                {isPlay ? (
                  <span className="tabbar-play">
                    <GolfBallIcon size={46} />
                  </span>
                ) : (
                  tab.Icon && <tab.Icon size={tab.size} />
                )}
              </span>
              <span className="tabbar-label">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
