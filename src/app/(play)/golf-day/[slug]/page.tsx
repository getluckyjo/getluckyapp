'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import AppHeader from '@/components/layout/AppHeader'
import BottomTabBar from '@/components/layout/BottomTabBar'
import PullToRefresh from '@/components/pwa/PullToRefresh'
import AddToHomeSheet, { useCanOfferInstall, useInstallState, usePlatform } from '@/components/pwa/AddToHomeSheet'
import { useAuth } from '@/context/AuthContext'
import { useBet } from '@/context/BetContext'
import { useRefreshSignal } from '@/hooks/useRefreshSignal'
import { setGolfDayTab } from '@/hooks/useGolfDayTab'
import { track } from '@/lib/analytics'
import { promptInstall } from '@/lib/pwa/install'
import { formatRand } from '@/lib/format'
import { GOLF_DAY_TIER } from '@/lib/tiers'
import { themeFor } from '@/lib/golf-days/themes'
import {
  formatGolfDayDate, golfDayPath, shortCourseName,
  type GolfDayHole, type GolfDayMe, type PublicGolfDay,
} from '@/lib/golf-days/rules'

interface Loaded { golfDay: PublicGolfDay; me: GolfDayMe | null }

/** Set before sending a player to sign in from this screen, so they are joined on the way back. */
const JOIN_AFTER_SIGN_IN = 'gl_golf_day_join'

/** Whether this player left to sign in from this golf day's Join; reading it clears it. */
function takeJoinFlag(slug: string): boolean {
  try {
    if (sessionStorage.getItem(JOIN_AFTER_SIGN_IN) !== slug) return false
    sessionStorage.removeItem(JOIN_AFTER_SIGN_IN)
    return true
  } catch {
    return false // storage blocked: they tap Join instead
  }
}

/** The club all the holes belong to ("Royal Johannesburg & Kensington"), or the course names. */
function venueOf(holes: GolfDayHole[]): string {
  const names = [...new Set(holes.map(h => h.course.name))]
  const clubs = [...new Set(names.map(n => (n.includes(' – ') ? n.slice(0, n.lastIndexOf(' – ')) : n)))]
  return clubs.length === 1 ? clubs[0] : names.join(' · ')
}

/** A course as the golf day names its venue: "Royal Johannesburg – West". */
function CourseName({ name, venue }: { name: string; venue: string | null }) {
  const dash = name.lastIndexOf(' – ')
  return <>{venue && dash !== -1 ? `${venue} – ${name.slice(dash + 3)}` : name}</>
}

/** "Bomb Squad Golf Day" sets as the host, then GOLF DAY on a line of its own. */
function nameLines(name: string): [string, string | null] {
  const m = /^(.*\S)\s+(golf day)$/i.exec(name.trim())
  return m ? [m[1], m[2]] : [name, null]
}

function holeTitle(hole: GolfDayHole, all: GolfDayHole[]): string {
  const course = shortCourseName(hole.course.name, all.map(h => h.course.name))
  return `${course} · Hole ${hole.holeNumber}`
}

function holeMeta(hole: GolfDayHole): string {
  return `Par ${hole.par}${hole.distanceMetres ? ` · ${hole.distanceMetres} m` : ''}`
}

/**
 * A golf day's screen — the link its players are sent, and afterwards their
 * tab in place of Icons.
 *
 * Signed out, it shows the day, the prize and the holes, and a way in. A
 * signed-in player joins with one tap (or is joined on the way back from
 * signing in). On the day, their one free swing is a tap on the hole they
 * are standing on; it goes straight to the record screen. After that it
 * says where their swing stands.
 *
 * The look is the host's (src/lib/golf-days/themes.ts); the facts come from
 * /api/golf-days/[slug]. A golf day's prize is Get Lucky's own, so nothing
 * here names an insurer.
 */
export default function GolfDayPage() {
  const params = useParams<{ slug: string }>()
  const slug = String(params?.slug ?? '')
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { selectCourse, selectTier, setPrizeZAR, setBetId, resetSession } = useBet()
  const refreshTick = useRefreshSignal()
  const theme = themeFor(slug)

  const [data, setData] = useState<Loaded | null>(null)
  const [missing, setMissing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<'join' | 'swing' | null>(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<GolfDayHole | null>(null)
  const [reload, setReload] = useState(0)
  // The home screen pop-up: 'joined' straight after joining, 'asked' from the link.
  const [installSheet, setInstallSheet] = useState<'joined' | 'asked' | null>(null)
  const offerInstall = useCanOfferInstall()
  const platform = usePlatform()
  const { canPrompt } = useInstallState()

  /**
   * Join, then put the app on the home screen: the next step after signing
   * in. A tap on Join on Android Chrome opens Chrome's own install dialog
   * straight away (it must follow a tap, and this is one). Everywhere else,
   * and when joined on the way back from signing in, the pop-up opens.
   */
  const join = useCallback(async (fromTap: boolean) => {
    if (!user) return
    setBusy('join')
    setError('')
    try {
      const res = await fetch(`/api/golf-days/${encodeURIComponent(slug)}/join`, { method: 'POST' })
      const body = await res.json().catch(() => ({})) as { joined?: boolean; slug?: string; tabLabel?: string; error?: string }
      if (res.ok && body.joined && body.slug && body.tabLabel) {
        setGolfDayTab(user.id, { slug: body.slug, tabLabel: body.tabLabel })
        track('golf_day_joined', { golf_day: slug })
        setReload(n => n + 1)
        if (offerInstall) {
          const outcome = fromTap && platform === 'android' && canPrompt ? await promptInstall() : 'unavailable'
          if (outcome === 'accepted') track('pwa_install', { source: 'golf_day' })
          if (outcome === 'unavailable') {
            track('pwa_install_prompt_shown', { platform: 'golf_day' })
            setInstallSheet('joined')
          }
        }
      } else {
        setError(body.error ?? 'You could not be joined. Please try again.')
      }
    } catch {
      setError('You could not be joined. Please try again.')
    } finally {
      setBusy(null)
    }
  }, [slug, user, offerInstall, platform, canPrompt])

  // What the screen shows depends on who is looking, so it waits for auth.
  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    fetch(`/api/golf-days/${encodeURIComponent(slug)}`)
      .then(async r => {
        if (cancelled) return
        if (r.status === 404) { setMissing(true); return }
        if (!r.ok) { setFailed(true); return }
        const loaded = await r.json() as Loaded
        if (cancelled) return
        setFailed(false)
        setData(loaded)
        // Back from signing in through "Sign in to join": join without a second tap.
        const { me, golfDay } = loaded
        if (me && !me.joined && !golfDay.closed && !golfDay.full && golfDay.phase !== 'over' && takeJoinFlag(slug)) void join(false)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [slug, authLoading, user?.id, refreshTick, reload, join])

  function signInToJoin() {
    try { sessionStorage.setItem(JOIN_AFTER_SIGN_IN, slug) } catch { /* storage blocked: they tap Join after */ }
    router.push(`/auth?next=${encodeURIComponent(golfDayPath(slug))}`)
  }

  /** Put the bet on this session's context, exactly as the stake screen does, and go film it. */
  function goRecord(betId: string, hole: GolfDayHole, prizeZAR: number) {
    resetSession()
    selectCourse(
      { id: hole.course.id, name: hole.course.name, location: hole.course.location, region: hole.course.region, emoji: '⛳' },
      { id: hole.holeId, courseId: hole.course.id, holeNumber: hole.holeNumber, par: hole.par, distanceMetres: hole.distanceMetres ?? 0 },
    )
    selectTier(GOLF_DAY_TIER.tier)
    setPrizeZAR(prizeZAR)
    setBetId(betId)
    router.push('/record')
  }

  async function startSwing(hole: GolfDayHole) {
    if (!data) return
    setBusy('swing')
    setError('')
    try {
      const res = await fetch(`/api/golf-days/${encodeURIComponent(slug)}/swing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holeId: hole.holeId }),
      })
      const body = await res.json().catch(() => ({})) as { betId?: string; prizeZAR?: number; error?: string; code?: string }
      if (res.ok && body.betId) {
        track('golf_day_swing_started', { golf_day: slug })
        goRecord(body.betId, hole, body.prizeZAR ?? data.golfDay.prizeZAR)
        return
      }
      if (body.code === 'AGE_NOT_VERIFIED') {
        router.push(`/age-check?next=${encodeURIComponent(golfDayPath(slug))}`)
        return
      }
      setError(body.error ?? 'Your swing could not be started. Please try again.')
      setPicked(null)
      setReload(n => n + 1)
    } catch {
      setError('Your swing could not be started. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const vars = {
    '--gd-ink': theme.ink, '--gd-accent': theme.accent, '--gd-paper': theme.paper, '--gd-page': theme.page,
  } as CSSProperties

  const golfDay = data?.golfDay
  const [nameTop, nameBottom] = golfDay ? nameLines(golfDay.name) : ['', null]
  const me = data?.me ?? null
  const swingHole = me?.swing ? golfDay?.holes.find(h => h.holeId === me.swing!.holeId) ?? null : null

  return (
    <PhoneFrame statusTheme="dark">
      <div className={`v2-screen gd-screen${theme.heroImage ? ' gd-branded' : ''}`} style={vars}>
        <PullToRefresh />
        <AppHeader tone="light" />

        <div className="vf-scroll gd-scroll">
          {theme.heroImage && (
            <div className="gd-hero">
              <Image src={theme.heroImage} alt={theme.heroAlt} width={1000} height={1244} sizes="480px" priority />
            </div>
          )}

          {missing ? (
            <section className="gd-label">
              <h1 className="gd-name">Link not found</h1>
              <p className="gd-copy">That golf day link is not valid. Check the message it came in, or ask the organiser for it again.</p>
            </section>
          ) : !golfDay ? (
            <section className="gd-label" aria-busy={!failed}>
              {failed ? (
                <>
                  <p className="gd-copy">This golf day could not be loaded.</p>
                  <button type="button" className="btn-lime btn-lime--block" onClick={() => { setFailed(false); setReload(n => n + 1) }}>Try again</button>
                </>
              ) : <p className="gd-copy">Loading…</p>}
            </section>
          ) : (
            <>
              <section className="gd-label">
                <p className="gd-kicker">{theme.host} <span aria-hidden>×</span> Get Lucky</p>
                <h1 className="gd-name">{nameTop}{nameBottom && <><br />{nameBottom}</>}</h1>
                <p className="gd-prize">{formatRand(golfDay.prizeZAR)}</p>
                <p className="gd-band"><span>Free swing</span></p>
                <p className="gd-meta">{theme.venue ?? venueOf(golfDay.holes)}<br />{formatGolfDayDate(golfDay.playsOn)}</p>
                <p className="gd-tagline">{theme.tagline}</p>
              </section>

              <section className="gd-action" aria-live="polite">
                {error && <div className="auth-error" role="alert">{error}</div>}
                <Action
                  golfDay={golfDay}
                  me={me}
                  signedIn={Boolean(user)}
                  busy={busy}
                  swingHole={swingHole}
                  onSignIn={signInToJoin}
                  onJoin={() => join(true)}
                  onInstall={offerInstall ? () => setInstallSheet('asked') : undefined}
                  onPick={setPicked}
                  onResume={() => swingHole && me?.swing && goRecord(me.swing.betId, swingHole, golfDay.prizeZAR)}
                />
              </section>

              <section className="gd-card">
                <h2 className="gd-h2">The {golfDay.holes.length === 1 ? 'hole' : 'holes'}</h2>
                <ul className="gd-holes">
                  {golfDay.holes.map(h => (
                    <li key={h.holeId}><strong>{holeTitle(h, golfDay.holes)}</strong><span>{holeMeta(h)}</span></li>
                  ))}
                </ul>
                <p className="gd-small">Play your swing on whichever of these your round takes you to.</p>
              </section>

              <section className="gd-card">
                <h2 className="gd-h2">How it works</h2>
                <ol className="gd-steps">
                  <li><strong>Join before the day.</strong> Sign in from this link and tap Join. Your {golfDay.tabLabel} tab appears at the bottom of the app.</li>
                  <li><strong>On the tee.</strong> Open the {golfDay.tabLabel} tab and tap the hole you are on. That starts your swing.</li>
                  <li><strong>Film it.</strong> Hand your phone to a playing partner. They film your tee shot in the app.</li>
                  <li><strong>Hole it.</strong> Claim in the app. Once the club and your playing partners confirm it, the {formatRand(golfDay.prizeZAR)} is yours.</li>
                </ol>
              </section>

              <p className="gd-rules">
                One swing per player, on {formatGolfDayDate(golfDay.playsOn)} only, on the holes above, filmed in the app.
                18+ only. A hole-in-one is paid after our review and confirmation from the club and your playing partners.
                The prize is paid by Get Lucky. <a href="/terms">Terms</a>
              </p>
              {theme.footnote && <p className="gd-footnote">{theme.footnote}</p>}
            </>
          )}
        </div>

        {picked && golfDay && (
          <>
            <div className="stake-backdrop" onClick={() => !busy && setPicked(null)} />
            <div className="cs-sheet stake-sheet" role="dialog" aria-modal="true" aria-label="Start your swing">
              <div className="cs-sheet-top">
                <div className="stake-sheet-title">Your swing</div>
                {!busy && <button type="button" className="cs-sheet-close" aria-label="Cancel" onClick={() => setPicked(null)}>×</button>}
              </div>
              <dl className="stake-rows">
                <div><dt>Course</dt><dd><CourseName name={picked.course.name} venue={theme.venue} /></dd></div>
                <div><dt>Hole</dt><dd>Hole {picked.holeNumber} · {holeMeta(picked)}</dd></div>
                <div className="stake-rows-win"><dt>You could win</dt><dd>{formatRand(golfDay.prizeZAR)}</dd></div>
              </dl>
              <button type="button" className="btn-lime btn-lime--block" onClick={() => startSwing(picked)} disabled={busy === 'swing'}>
                {busy === 'swing' ? 'Setting up your shot…' : 'Start my swing'}
              </button>
              <p className="stake-free-note">
                You get one swing, and this uses it. Tap only when you are on this tee with a playing partner ready to film.
              </p>
            </div>
          </>
        )}

        {installSheet && golfDay && (
          <AddToHomeSheet
            title={installSheet === 'joined' ? 'You\u2019re in. One more step' : 'Put Get Lucky on your home screen'}
            lead={`Put Get Lucky on your home screen, so your ${golfDay.tabLabel} swing is one tap away on the day.`}
            source="golf_day"
            onClose={() => setInstallSheet(null)}
          />
        )}

        <BottomTabBar active="golfday" />
      </div>
    </PhoneFrame>
  )
}

function Action({ golfDay, me, signedIn, busy, swingHole, onSignIn, onJoin, onPick, onResume, onInstall }: {
  golfDay: PublicGolfDay
  me: GolfDayMe | null
  signedIn: boolean
  busy: 'join' | 'swing' | null
  swingHole: GolfDayHole | null
  onSignIn: () => void
  onJoin: () => void
  onPick: (hole: GolfDayHole) => void
  onResume: () => void
  /** Opens the home screen pop-up; absent when there is nothing to offer (installed, desktop). */
  onInstall?: () => void
}) {
  const date = formatGolfDayDate(golfDay.playsOn)
  const joined = Boolean(me?.joined)

  if (golfDay.closed) return <p className="gd-status">This golf day is closed.</p>

  // ── Not in yet ──
  if (!joined) {
    if (golfDay.phase === 'over') return <p className="gd-status">This golf day is over. Thanks to everyone who played.</p>
    if (golfDay.full) return <p className="gd-status">Every place on this golf day has been taken.</p>
    if (!signedIn) {
      return (
        <>
          <button type="button" className="btn-lime btn-lime--block" onClick={onSignIn}>Sign in to join</button>
          <p className="gd-small">Google or your email, then your date of birth (18+). It takes a minute. Do it before the day.</p>
        </>
      )
    }
    return (
      <button type="button" className="btn-lime btn-lime--block" onClick={onJoin} disabled={busy === 'join'}>
        {busy === 'join' ? 'Joining…' : 'Join the golf day'}
      </button>
    )
  }

  // ── Their swing, once taken ──
  const swing = me?.swing
  if (swing) {
    if (swing.status === 'active') {
      return swing.open ? (
        <>
          <p className="gd-status">Your swing is started{swingHole ? ` on hole ${swingHole.holeNumber}` : ''}. Film it now.</p>
          <button type="button" className="btn-lime btn-lime--block" onClick={onResume} disabled={!swingHole}>Film my swing</button>
        </>
      ) : <p className="gd-status">Your swing was started but never filmed, and its window has closed.</p>
    }
    if (swing.status === 'miss') return <p className="gd-status">Your swing is in. Not this time. Thanks for playing.</p>
    if (swing.status === 'claimed') return <p className="gd-status">Your hole-in-one claim is in. We are checking the footage and speaking to the club and your playing partners.</p>
    if (swing.status === 'verified') return <p className="gd-status">Verified. {formatRand(golfDay.prizeZAR)} is on its way to you.</p>
    if (swing.status === 'paid') return <p className="gd-status">Paid. Congratulations on your hole-in-one.</p>
    return <p className="gd-status">Your swing is in.</p>
  }

  // ── Joined, swing still to come ──
  if (golfDay.phase === 'upcoming') {
    return (
      <>
        <p className="gd-status"><strong>You&rsquo;re in.</strong> Your swing opens on {date}. Come back to this tab when you reach one of the holes below.</p>
        {onInstall && <button type="button" className="gd-link" onClick={onInstall}>Put Get Lucky on your home screen</button>}
      </>
    )
  }
  if (golfDay.phase === 'over') return <p className="gd-status">The golf day is over and your swing was not taken.</p>
  return (
    <>
      <p className="gd-status"><strong>It&rsquo;s today.</strong> Tap the hole you are on to take your swing.</p>
      <div className="gd-pick">
        {golfDay.holes.map(h => (
          <button key={h.holeId} type="button" className="gd-hole" onClick={() => onPick(h)} disabled={busy !== null}>
            <span className="gd-hole-name">{holeTitle(h, golfDay.holes)}</span>
            <span className="gd-hole-meta">{holeMeta(h)}</span>
          </button>
        ))}
      </div>
    </>
  )
}
