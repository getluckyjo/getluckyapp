'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import BottomTabBar from '@/components/layout/BottomTabBar'
import AppHeader from '@/components/layout/AppHeader'
import PullToRefresh from '@/components/pwa/PullToRefresh'
import { useRefreshSignal } from '@/hooks/useRefreshSignal'
import { useAuth } from '@/context/AuthContext'
import { track } from '@/lib/analytics'
import { haptics } from '@/lib/haptics'
import { ICONS_EVENT, iconInitials, withShares, type PublicIcon } from '@/lib/icons'

interface Payload {
  event: typeof ICONS_EVENT
  icons: PublicIcon[]
  totalVotes: number
  myVote: string | null
}

/**
 * Icons — "Back an Icon". The field for Icons Cup South Africa, how many
 * golfers back each one, and the caller's own pick. One pick per golfer,
 * changeable. No prize is stated anywhere on this screen by design (see
 * src/lib/icons.ts).
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

  async function back(iconId: string) {
    if (!user) {
      router.push(`/auth?next=${encodeURIComponent('/icons')}`)
      return
    }
    if (!data || saving || data.myVote === iconId) return
    setSaving(iconId)
    setError(null)
    const previous = data
    // Optimistic: move the pick, recount the shares.
    const moved = data.icons.map(i => ({
      ...i,
      votes: i.votes + (i.id === iconId ? 1 : 0) - (i.id === data.myVote ? 1 : 0),
    }))
    setData({ ...data, icons: withShares(moved), myVote: iconId, totalVotes: data.totalVotes + (data.myVote ? 0 : 1) })
    try {
      const res = await fetch('/api/icons/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iconId }),
      })
      if (res.status === 401) { router.push(`/auth?next=${encodeURIComponent('/icons')}`); return }
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
          <h1 className="v2-title" style={{ marginBottom: 8 }}>{'Back an\nIcon'}</h1>
          <p className="vf-sub">
            {ICONS_EVENT.name} · {ICONS_EVENT.venue} · {ICONS_EVENT.dates}.
            {' '}Which Icon holes it on the signature par 3? Pick one. You can change your mind until the first tee.
          </p>

          {mine && (
            <div className="ic-mine">
              <span className="ic-mine-label">You&rsquo;re backing</span>
              <span className="ic-mine-name">{mine.name}</span>
            </div>
          )}

          {!user && data && icons.length > 0 && (
            <button type="button" className="btn-lime btn-lime--block ic-signin" onClick={() => router.push(`/auth?next=${encodeURIComponent('/icons')}`)}>
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

          <div className="ic-list">
            {icons.map(icon => {
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
                    <span className="ic-name">{icon.name}</span>
                    {icon.tagline && <span className="ic-tag">{icon.tagline}</span>}
                    <span className="ic-bar" aria-hidden><span className="ic-bar-fill" style={{ width: `${icon.percent}%` }} /></span>
                  </span>
                  <span className="ic-pct">
                    <span className="ic-pct-num">{icon.percent}%</span>
                    <span className="ic-pct-sub">{picked ? 'Your pick' : `${icon.votes} backing`}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {data && data.totalVotes > 0 && (
            <p className="lb-note">{data.totalVotes} {data.totalVotes === 1 ? 'golfer has' : 'golfers have'} picked so far. One pick per golfer.</p>
          )}
        </div>

        <BottomTabBar active="icons" />
      </div>
    </PhoneFrame>
  )
}
