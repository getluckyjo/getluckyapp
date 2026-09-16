'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PhoneFrame from '@/components/layout/PhoneFrame'
import BottomTabBar from '@/components/layout/BottomTabBar'
import AppHeader from '@/components/layout/AppHeader'
import { useAuth } from '@/context/AuthContext'
import { useMembership } from '@/hooks/useMembership'
import MemberBadge from '@/components/membership/MemberBadge'
import { MEMBERSHIP_PLANS } from '@/lib/membership'
import { createClient } from '@/lib/supabase/client'
import { getInitials } from '@/lib/format'
import { buildLabel } from '@/lib/version'

const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 5l7 7-7 7" />
  </svg>
)

/**
 * Account — the golfer's own card in the V2 system.
 * A green identity card with a lime initials disc, two stat tiles, then
 * white cards for profile details (with inline edit), the club, and the
 * legal links. Sign out sits last and quiet.
 */
export default function AccountPage() {
  const router = useRouter()
  const { user, profile, signOut, refreshProfile, loading } = useAuth()
  const { isMember, plan, joinedDate } = useMembership()

  // Profile editing
  const [editingProfile, setEditingProfile] = useState(false)
  const [editName, setEditName]             = useState('')
  const [editHandicap, setEditHandicap]     = useState('')
  const [savingProfile, setSavingProfile]   = useState(false)

  // Account deletion
  type DeletionInfo = { canDelete: boolean; reason: string | null; message: string | null; activeBets: number }
  const [deleteStep, setDeleteStep] = useState<'idle' | 'checking' | 'confirm' | 'working'>('idle')
  const [deletion, setDeletion] = useState<DeletionInfo | null>(null)

  // Toast
  const [toast, setToast] = useState<string | null>(null)
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const displayName = profile?.name ?? user?.user_metadata?.full_name ?? null
  const initials    = getInitials(displayName, user?.email)
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })
    : '—'

  async function saveProfile() {
    if (!user) return
    setSavingProfile(true)
    const supabase = createClient()
    try {
      await supabase.from('profiles').upsert({
        id: user.id,
        ...(editName.trim()   ? { name: editName.trim() } : {}),
        ...(editHandicap !== '' ? { handicap: parseInt(editHandicap, 10) } : {}),
      })
    } catch { /* ignore */ }
    await refreshProfile()
    setSavingProfile(false)
    setEditingProfile(false)
    showToast('Profile updated')
  }

  async function openDelete() {
    setDeleteStep('checking')
    try {
      const res = await fetch('/api/account')
      if (!res.ok) throw new Error(String(res.status))
      setDeletion(await res.json())
      setDeleteStep('confirm')
    } catch {
      setDeleteStep('idle')
      showToast('Could not check your account. Please try again.')
    }
  }

  async function confirmDelete() {
    setDeleteStep('working')
    try {
      const res = await fetch('/api/account', { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Your account could not be deleted. Nothing has been removed.')
      }
      await signOut()
      router.replace('/splash')
    } catch (err) {
      setDeleteStep('confirm')
      showToast(err instanceof Error ? err.message : 'Your account could not be deleted.')
    }
  }

  function startEditing() {
    setEditName(displayName ?? '')
    setEditHandicap(profile?.handicap != null ? String(profile.handicap) : '')
    setEditingProfile(true)
  }

  const clubLine = (() => {
    const planKey = plan?.toLowerCase()
    const planText = planKey === 'monthly' || planKey === 'annual' ? MEMBERSHIP_PLANS[planKey].label : 'Active'
    const since = joinedDate
      ? ` · since ${new Date(joinedDate).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })}`
      : ''
    return `${planText}${since}`
  })()

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="vf-scroll">
          <h1 className="v2-title" style={{ marginBottom: 16 }}>{'My\naccount'}</h1>

          {/* ── Identity card ── */}
          <div className="acct-id">
            {loading ? (
              <div className="skeleton acct-avatar" style={{ opacity: 0.35 }} />
            ) : (
              <span className="acct-avatar" aria-hidden>{initials}</span>
            )}
            <div className="acct-id-text">
              {loading ? (
                <>
                  <div className="skeleton" style={{ height: 22, width: '60%', marginBottom: 8, opacity: 0.35 }} />
                  <div className="skeleton" style={{ height: 13, width: '80%', opacity: 0.35 }} />
                </>
              ) : (
                <>
                  <div className="acct-name">{displayName ?? 'Golfer'}</div>
                  <div className="acct-email">{user?.email ?? 'Not signed in'}</div>
                  {(profile?.handicap != null || isMember) && (
                    <div className="acct-chips">
                      {profile?.handicap != null && <span className="acct-chip">HCP {profile.handicap}</span>}
                      {isMember && <MemberBadge size="sm" />}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Stats ── */}
          <div className="acct-stats">
            {[
              { label: 'Member since', value: memberSince },
              { label: 'Attempts',     value: loading ? null : String(profile?.total_attempts ?? 0) },
            ].map(stat => (
              <div key={stat.label} className="acct-stat">
                {loading || stat.value === null ? (
                  <>
                    <div className="skeleton" style={{ height: 24, width: '55%', margin: '0 auto 6px' }} />
                    <div className="skeleton" style={{ height: 10, width: '45%', margin: '0 auto' }} />
                  </>
                ) : (
                  <>
                    <div className="acct-stat-val">{stat.value}</div>
                    <div className="acct-stat-label">{stat.label}</div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* ── Profile details ── */}
          <section className="acct-card">
            <header className="acct-card-head">
              <h2>Profile</h2>
              {!editingProfile && (
                <button type="button" className="acct-edit" onClick={startEditing} disabled={loading || !user}>
                  Edit
                </button>
              )}
            </header>

            {editingProfile ? (
              <div className="acct-form">
                <label className="acct-field">
                  <span>Full name</span>
                  <input
                    className="acct-input"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                  />
                </label>
                <label className="acct-field">
                  <span>Handicap (0 – 54)</span>
                  <input
                    className="acct-input"
                    type="number"
                    inputMode="numeric"
                    value={editHandicap}
                    onChange={e => setEditHandicap(e.target.value)}
                    placeholder="e.g. 18"
                    min={0} max={54}
                  />
                </label>
                <div className="acct-form-actions">
                  <button type="button" className="btn-tile" onClick={() => setEditingProfile(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn-lime" disabled={savingProfile} onClick={saveProfile}>
                    {savingProfile ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              [
                { label: 'Name',     value: displayName ?? '—', wide: false },
                { label: 'Email',    value: user?.email ?? '—', wide: true },
                { label: 'Handicap', value: profile?.handicap != null ? String(profile.handicap) : '—', wide: false },
              ].map(row => (
                <div key={row.label} className="acct-row">
                  <span className="acct-row-label">{row.label}</span>
                  {loading ? (
                    <div className="skeleton" style={{ height: 14, width: row.wide ? 140 : 80 }} />
                  ) : (
                    <span className="acct-row-val">{row.value}</span>
                  )}
                </div>
              ))
            )}
          </section>

          {/* ── Club ── */}
          {isMember ? (
            <button type="button" className="acct-card acct-card--tap" onClick={() => router.push('/membership')}>
              <div className="acct-row" style={{ borderBottom: 'none' }}>
                <span>
                  <span className="acct-row-title">Get Lucky Golf Club</span>
                  <span className="acct-row-sub">{clubLine}</span>
                </span>
                <span className="acct-row-end"><MemberBadge size="sm" /><Chevron /></span>
              </div>
            </button>
          ) : (
            <button type="button" className="acct-club" onClick={() => router.push('/membership')}>
              <span className="acct-club-text">
                <span className="acct-club-title">Join the club</span>
                <span className="acct-club-sub">Status, perks &amp; insured prizes from R{MEMBERSHIP_PLANS.monthly.priceZAR}/month</span>
              </span>
              <span className="acct-club-cta">Join</span>
            </button>
          )}

          {/* ── Legal ── */}
          <section className="acct-card">
            {[
              { label: 'Terms & conditions', href: '/terms' },
              { label: 'Privacy policy',     href: '/privacy' },
              { label: 'Responsible play',   href: '/responsible-play' },
            ].map(item => (
              <button key={item.href} type="button" className="acct-row acct-row--tap" onClick={() => router.push(item.href)}>
                <span className="acct-row-title">{item.label}</span>
                <span className="acct-row-end"><Chevron /></span>
              </button>
            ))}
          </section>

          <button
            type="button"
            className="acct-signout"
            onClick={async () => {
              await signOut()
              router.push('/auth')
            }}
          >
            Sign out
          </button>

          <p className="acct-version" aria-label="App version">Get Lucky · build {buildLabel()}</p>

          {/* ── Delete account ── */}
          <section className="acct-card" style={{ marginTop: 14 }}>
            {deleteStep === 'idle' || deleteStep === 'checking' ? (
              <button type="button" className="acct-row acct-row--tap" onClick={openDelete} disabled={loading || !user || deleteStep === 'checking'}>
                <span>
                  <span className="acct-row-title">Delete account</span>
                  <span className="acct-row-sub">Removes your profile, bets, footage and documents</span>
                </span>
                <span className="acct-row-end"><Chevron /></span>
              </button>
            ) : (
              <div className="acct-form">
                {deletion?.canDelete ? (
                  <>
                    {deletion.activeBets > 0 && (
                      <p className="acct-row-sub" style={{ display: 'block', marginBottom: 10 }}>
                        You have {deletion.activeBets} unplayed {deletion.activeBets === 1 ? 'challenge' : 'challenges'}. Deleting your account forfeits {deletion.activeBets === 1 ? 'it' : 'them'}; stakes are not refunded.
                      </p>
                    )}
                    <p className="acct-row-sub" style={{ display: 'block', marginBottom: 14 }}>
                      This removes your profile, your bets and your footage and documents. Payment records are kept without your name, as the law requires. This cannot be undone.
                    </p>
                  </>
                ) : (
                  <p className="acct-row-sub" style={{ display: 'block', marginBottom: 14 }}>
                    {deletion?.message ?? 'This account cannot be deleted right now.'}{' '}
                    <a href="mailto:support@getluckygolf.co.za" style={{ color: 'inherit', fontWeight: 700 }}>support@getluckygolf.co.za</a>
                  </p>
                )}
                <div className="acct-form-actions">
                  <button type="button" className="btn-tile" disabled={deleteStep === 'working'} onClick={() => setDeleteStep('idle')}>
                    Keep my account
                  </button>
                  {deletion?.canDelete && (
                    <button
                      type="button"
                      className="acct-signout"
                      style={{ margin: 0, borderColor: '#c0392b', color: '#c0392b' }}
                      disabled={deleteStep === 'working'}
                      onClick={confirmDelete}
                    >
                      {deleteStep === 'working' ? 'Deleting…' : 'Delete permanently'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        <BottomTabBar active="account" />
      </div>

      {toast && (
        <div role="status" aria-live="polite" className="toast" style={{ bottom: 'calc(var(--tab-bar-h) + 10px)', zIndex: 200 }}>
          {toast}
        </div>
      )}
    </PhoneFrame>
  )
}
