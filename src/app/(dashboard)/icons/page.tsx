'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import PhoneFrame from '@/components/layout/PhoneFrame'
import BottomTabBar from '@/components/layout/BottomTabBar'
import AppHeader from '@/components/layout/AppHeader'
import PullToRefresh from '@/components/pwa/PullToRefresh'
import { useRefreshSignal } from '@/hooks/useRefreshSignal'
import { useAuth } from '@/context/AuthContext'
import { track } from '@/lib/analytics'
import { haptics } from '@/lib/haptics'
import { ICONS_EVENT, TEAM_LABEL, iconInitials, withStandings, type IconTeam, type PublicIcon } from '@/lib/icons'

interface Payload {
  event: typeof ICONS_EVENT
  icons: PublicIcon[]
  totalVotes: number
  myVote: string | null
}

const TEAMS: IconTeam[] = ['rsa', 'world']

/**
 * Icons — "Back an Icon". Icons Cup South Africa, Team South Africa vs Team
 * World at The Links at Fancourt. The field by team, how many golfers back
 * each Icon (a count, with a bar against the favourite: one pick per golfer
 * makes a percentage misleading), and the caller's own pick. One pick per
 * golfer, changeable. Prize copy comes from src/lib/icons.ts, one place to
 * change it.
 */
export default function IconsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const refreshTick = useRefreshSignal()
  const [data, setData] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/icons')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json: Payload) => { if (!cancelled) { setData(json); setFailed(false) } })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [refreshTick, user?.id])

  const signIn = () => router.push(`/auth?next=${encodeURIComponent('/icons')}`)

  async function back(iconId: string) {
    if (!user) { signIn(); return }
    if (!data || saving || data.myVote === iconId) return
    setSaving(iconId)
    setError(null)
    const previous = data
    // Optimistic: move the pick, redraw the standings.
    const moved = data.icons.map(i => ({
      ...i,
      votes: i.votes + (i.id === iconId ? 1 : 0) - (i.id === data.myVote ? 1 : 0),
    }))
    setData({ ...data, icons: withStandings(moved), myVote: iconId, totalVotes: data.totalVotes + (data.myVote ? 0 : 1) })
    try {
      const res = await fetch('/api/icons/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iconId }),
      })
      if (res.status === 401) { signIn(); return }
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Could not save your pick')
      }
      haptics.success()
      track('icon_backed', { icon_id: iconId, changed: !!previous.myVote })
    } catch (err) {
      setData(previous)
      setError(err instanceof Error ? err.message : 'Could not save your pick')
    } finally {
      setSaving(null)
    }
  }

  const icons = data?.icons ?? []
  const mine = icons.find(i => i.id === data?.myVote) ?? null

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <PullToRefresh />
        <AppHeader tone="light" />

        <div className="vf-scroll">
          <div className="ic-hero">
            <Image src={ICONS_EVENT.hero} alt="Icons Cup South Africa, 11 to 13 December 2026, The Links at Fancourt" width={1200} height={675} sizes="480px" priority />
          </div>

          <h1 className="v2-title" style={{ marginBottom: 8 }}>{'Back an\nIcon'}</h1>
          <p className="vf-sub">{ICONS_EVENT.question} Pick one. Change it any time before the first tee.</p>

          <div className="ic-prize" aria-label={ICONS_EVENT.prizeTotal}>
            <div className="ic-prize-tiles">
              {ICONS_EVENT.prizes.map(p => (
                <div key={p.who} className="ic-prize-tile">
                  <span className="ic-prize-amt">
                    {p.amount}{p.count > 1 && <small>×{p.count}</small>}
                  </span>
                  <span className="ic-prize-who">{p.who}</span>
                </div>
              ))}
            </div>
            <span className="ic-prize-terms">{ICONS_EVENT.prizeTotal} · {ICONS_EVENT.prizeTerms}</span>
          </div>

          {mine && (
            <div className={`ic-mine is-${mine.team}`}>
              <span className="ic-mine-label">You&rsquo;re backing</span>
              <span className="ic-mine-name">{mine.name}</span>
              <span className="ic-mine-prize">If {mine.name} {ICONS_EVENT.fanStake}</span>
            </div>
          )}

          {!user && data && icons.length > 0 && (
            <button type="button" className="btn-lime btn-lime--block ic-signin" onClick={signIn}>
              Sign in to pick yours
            </button>
          )}

          {error && <p className="ic-error" role="alert">{error}</p>}

          {data === null && !failed && (
            <div className="ic-list" aria-hidden>
              {[0, 1, 2].map(i => <div key={i} className="ic-card skeleton" style={{ minHeight: 76 }} />)}
            </div>
          )}

          {failed && (
            <p className="lb-note" style={{ marginTop: 24 }}>Could not load the Icons. Pull down to try again.</p>
          )}

          {data && icons.length === 0 && (
            <p className="lb-note" style={{ marginTop: 24 }}>The field hasn&rsquo;t been announced yet. Check back soon.</p>
          )}

          {TEAMS.map(team => {
            const members = icons.filter(i => i.team === team)
            if (members.length === 0) return null
            return (
              <section key={team} className={`ic-team is-${team}`} aria-label={TEAM_LABEL[team]}>
                <h2 className="ic-team-title"><span className="ic-team-dot" aria-hidden />{TEAM_LABEL[team]}</h2>
                <div className="ic-list">
                  {members.map(icon => {
                    const picked = data?.myVote === icon.id
                    return (
                      <button
                        key={icon.id}
                        type="button"
                        className={`ic-card${picked ? ' is-picked' : ''}`}
                        aria-pressed={picked}
                        disabled={saving !== null}
                        onClick={() => back(icon.id)}
                      >
                        <span className="ic-avatar" aria-hidden>
                          {icon.photoUrl
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={icon.photoUrl} alt="" loading="lazy" decoding="async" />
                            : iconInitials(icon.name)}
                        </span>
                        <span className="ic-info">
                          <span className="ic-name">
                            {icon.name}
                            {icon.isCaptain && <span className="ic-captain">Captain</span>}
                            {icon.isLeader && <span className="ic-lead">Fan favourite</span>}
                          </span>
                          {icon.tagline && <span className="ic-tag">{icon.tagline}</span>}
                          <span className="ic-bar" aria-hidden><span className="ic-bar-fill" style={{ width: `${icon.share}%` }} /></span>
                        </span>
                        <span className="ic-pct">
                          <span className="ic-pct-num">{icon.votes}</span>
                          <span className="ic-pct-sub">{picked ? 'Your pick' : 'backing'}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}

          <p className="ic-sponsor">
            {data && data.totalVotes > 0 && <>{data.totalVotes} {data.totalVotes === 1 ? 'golfer has' : 'golfers have'} picked · </>}
            {ICONS_EVENT.sponsorLine}
          </p>
        </div>

        <BottomTabBar active="icons" />
      </div>
    </PhoneFrame>
  )
}
