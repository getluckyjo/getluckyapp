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

function getInitials(name: string | null | undefined, email: string | null | undefined) {
  if (name) return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
  if (email) return email[0].toUpperCase()
  return 'GL'
}

export default function AccountPage() {
  const router = useRouter()
  const { user, profile, signOut, refreshProfile, loading } = useAuth()
  const { isMember, plan, joinedDate } = useMembership()

  // Profile editing
  const [editingProfile, setEditingProfile] = useState(false)
  const [editName, setEditName]             = useState('')
  const [editHandicap, setEditHandicap]     = useState('')
  const [savingProfile, setSavingProfile]   = useState(false)

  // Toast
  const [toast, setToast] = useState<string | null>(null)
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const displayName = profile?.name ?? user?.user_metadata?.full_name ?? null
  const initials    = getInitials(displayName, user?.email)
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
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
    showToast('Profile updated ✓')
  }

  return (
    <PhoneFrame statusTheme="dark" hideSponsor>

      {/* ── Scrollable body ── */}
      <div style={{ overflowY: 'auto', height: '100%', background: 'var(--cream)' }}>
        <AppHeader tone="light" />

        {/* Header */}
        <header className="page-head" style={{ display: 'block', paddingBottom: 'var(--space-lg)' }}>
          <h1 className="page-title">My Account</h1>
          <div className="page-sub">Manage your profile &amp; preferences</div>
        </header>

        {/* ── Identity card ── */}
        <div style={{ padding: '0 var(--page-px)', marginBottom: 'var(--space-lg)' }}>
          <div style={{
            background: 'linear-gradient(135deg, var(--green-deep) 0%, #2d6a3f 100%)',
            borderRadius: 'var(--radius-lg)', padding: 'var(--space-xl) var(--page-px)',
            display: 'flex', alignItems: 'center', gap: 'var(--space-lg)',
          }}>
            {loading ? (
              <div className="skeleton" style={{ width: 72, height: 72, borderRadius: '50%', flexShrink: 0, opacity: 0.3 }} />
            ) : (
              <div style={{
                width: 'clamp(60px, 18vw, 72px)', height: 'clamp(60px, 18vw, 72px)', borderRadius: '50%',
                background: 'rgba(255,255,255,0.15)',
                border: '2.5px solid rgba(255,255,255,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'white', flexShrink: 0,
                fontFamily: 'Poster Gothic, sans-serif',
              }}>
                {initials}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              {loading ? (
                <>
                  <div className="skeleton" style={{ height: 20, width: '60%', marginBottom: 8, borderRadius: 4 }} />
                  <div className="skeleton" style={{ height: 13, width: '80%', borderRadius: 4 }} />
                </>
              ) : (
                <>
                  <div style={{
                    fontSize: 'var(--text-lg)', fontWeight: 700, color: 'white',
                    lineHeight: 1.3,
                    fontFamily: 'Poster Gothic, sans-serif',
                  }}>
                    {displayName ?? 'Golfer'}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.7)', marginTop: 3, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                    {user?.email}
                  </div>
                  {profile?.handicap != null && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center',
                      marginTop: 'var(--space-xs)', padding: '3px 10px',
                      background: 'rgba(255,255,255,0.15)',
                      borderRadius: 20, fontSize: 'var(--text-xs)', fontWeight: 600,
                      color: 'rgba(255,255,255,0.9)',
                    }}>
                      HCP {profile.handicap}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Profile details ── */}
        <div style={{ padding: '0 var(--page-px)', marginBottom: 'var(--space-md)' }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid #e8e4dc', overflow: 'hidden' }}>

            {/* Section header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 'var(--space-md) var(--space-lg)', borderBottom: '1px solid #f0ebe0',
            }}>
              <div style={{ fontSize: 'var(--text-body)', fontWeight: 700, color: 'var(--green-deep)' }}>Profile Details</div>
              {!editingProfile && (
                <button
                  onClick={() => {
                    setEditName(displayName ?? '')
                    setEditHandicap(profile?.handicap != null ? String(profile.handicap) : '')
                    setEditingProfile(true)
                  }}
                  style={{
                    padding: '5px 12px', background: '#f5f0e8', border: 'none',
                    borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', fontWeight: 600,
                    color: 'var(--green-deep)', cursor: 'pointer',
                  }}
                >
                  Edit
                </button>
              )}
            </div>

            {editingProfile ? (
              /* Edit form */
              <div style={{ padding: 'var(--space-lg)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  <div>
                    <label style={{
                      fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--gray-light)',
                      display: 'block', marginBottom: 6,
                      textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                    }}>
                      Full Name
                    </label>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      placeholder="Your name"
                      style={{
                        width: '100%', padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-sm)',
                        border: '1.5px solid #d0c9be', fontSize: 'var(--text-body)', outline: 'none',
                        boxSizing: 'border-box' as const, background: '#faf8f4', color: 'var(--green-deep)',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{
                      fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--gray-light)',
                      display: 'block', marginBottom: 6,
                      textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                    }}>
                      Handicap (0 – 54)
                    </label>
                    <input
                      type="number"
                      value={editHandicap}
                      onChange={e => setEditHandicap(e.target.value)}
                      placeholder="e.g. 18"
                      min={0} max={54}
                      style={{
                        width: '100%', padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-sm)',
                        border: '1.5px solid #d0c9be', fontSize: 'var(--text-body)', outline: 'none',
                        boxSizing: 'border-box' as const, background: '#faf8f4', color: 'var(--green-deep)',
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
                  <button
                    onClick={() => setEditingProfile(false)}
                    style={{
                      flex: 1, padding: 'var(--space-sm)', background: '#f5f0e8', border: 'none',
                      borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-md)', fontWeight: 600,
                      color: '#888', cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={savingProfile}
                    onClick={saveProfile}
                    style={{
                      flex: 2, padding: 'var(--space-sm)', background: 'var(--green-deep)',
                      border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-md)',
                      fontWeight: 700, color: 'white', cursor: 'pointer',
                      opacity: savingProfile ? 0.7 : 1,
                    }}
                  >
                    {savingProfile ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            ) : (
              /* Read-only rows */
              <>
                {[
                  { label: 'Full Name', value: displayName ?? '—' },
                  { label: 'Email',     value: user?.email ?? '—' },
                  { label: 'Handicap',  value: profile?.handicap != null ? String(profile.handicap) : '—' },
                ].map((row, i, arr) => (
                  <div
                    key={row.label}
                    style={{
                      padding: 'var(--space-md) var(--space-lg)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      borderBottom: i < arr.length - 1 ? '1px solid #f8f4ee' : 'none',
                    }}
                  >
                    <span style={{ fontSize: 'var(--text-body)', color: 'var(--gray-light)' }}>{row.label}</span>
                    {loading ? (
                      <div className="skeleton" style={{ height: 14, width: row.label === 'Email' ? 140 : 80, borderRadius: 4 }} />
                    ) : (
                      <span style={{
                        fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--black)',
                        textAlign: 'right', wordBreak: 'break-word',
                      }}>
                        {row.value}
                      </span>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* ── Stats ── */}
        <div style={{ padding: '0 var(--page-px)', marginBottom: 'var(--space-md)' }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid #e8e4dc', overflow: 'hidden' }}>
            <div style={{ padding: 'var(--space-md) var(--space-lg)', borderBottom: '1px solid #f0ebe0' }}>
              <div style={{ fontSize: 'var(--text-body)', fontWeight: 700, color: 'var(--green-deep)' }}>Your Stats</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: '#f0ebe0' }}>
              {[
                { label: 'Member Since',    value: memberSince },
                { label: 'Total Attempts',  value: loading ? null : String(profile?.total_attempts ?? 0) },
              ].map(stat => (
                <div key={stat.label} style={{ background: 'white', padding: 'var(--space-lg)', textAlign: 'center' }}>
                  {loading || stat.value === null ? (
                    <>
                      <div className="skeleton" style={{ height: 20, width: '65%', margin: '0 auto 6px', borderRadius: 4 }} />
                      <div className="skeleton" style={{ height: 11, width: '50%', margin: '0 auto', borderRadius: 4 }} />
                    </>
                  ) : (
                    <>
                      <div style={{
                        fontFamily: 'Poster Gothic, sans-serif',
                        fontSize: 'var(--text-md)', fontWeight: 800, color: 'var(--green-deep)',
                      }}>
                        {stat.value}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-light)', marginTop: 3 }}>{stat.label}</div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Membership ── */}
        <div style={{ padding: '0 var(--page-px)', marginBottom: 'var(--space-md)' }}>
          {isMember ? (
            <button
              onClick={() => router.push('/membership')}
              style={{
                width: '100%', textAlign: 'left', cursor: 'pointer',
                background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid #e8e4dc',
                padding: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 'var(--text-body)', fontWeight: 700, color: 'var(--green-deep)' }}>Get Lucky Golf Club</span>
                  <MemberBadge size="sm" />
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--gray-light)' }}>
                  {(() => {
                    const planKey = plan?.toLowerCase()
                    const planText = planKey === 'monthly' || planKey === 'annual'
                      ? MEMBERSHIP_PLANS[planKey].label
                      : 'Active'
                    const since = joinedDate
                      ? ` · member since ${new Date(joinedDate).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })}`
                      : ''
                    return `${planText}${since}`
                  })()}
                </div>
              </div>
              <span style={{ color: 'var(--gray-light)', fontSize: 'var(--text-sm)' }}>→</span>
            </button>
          ) : (
            <button
              onClick={() => router.push('/membership')}
              style={{
                width: '100%', textAlign: 'left', cursor: 'pointer',
                background: 'linear-gradient(135deg, var(--green-deep) 0%, #2d6a3f 100%)',
                borderRadius: 'var(--radius-lg)', border: 'none',
                padding: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--text-body)', fontWeight: 700, color: 'white', marginBottom: 4 }}>
                  Become a Member
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.78)', lineHeight: 1.4 }}>
                  Status, perks &amp; insured prizes from R{MEMBERSHIP_PLANS.monthly.priceZAR}/mo
                </div>
              </div>
              <span style={{
                flexShrink: 0, padding: '7px 14px', background: 'var(--gold)', color: '#3a2f12',
                borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)', fontWeight: 700,
              }}>
                Join
              </span>
            </button>
          )}
        </div>

        {/* ── Legal links ── */}
        <div style={{ padding: '0 var(--page-px)', marginBottom: 'var(--space-md)' }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid #e8e4dc', overflow: 'hidden' }}>
            {[
              { label: 'Terms & Conditions', href: '/terms' },
              { label: 'Privacy Policy', href: '/privacy' },
              { label: 'Responsible Play', href: '/responsible-play' },
            ].map((item, i, arr) => (
              <button
                key={item.label}
                onClick={() => router.push(item.href)}
                style={{
                  width: '100%', padding: 'var(--space-md) var(--space-lg)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: i < arr.length - 1 ? '1px solid #f8f4ee' : 'none',
                  fontSize: 'var(--text-body)', color: 'var(--green-deep)', fontWeight: 500,
                  textAlign: 'left',
                }}
              >
                {item.label}
                <span style={{ color: 'var(--gray-light)', fontSize: 'var(--text-sm)' }}>→</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Sign out ── */}
        <div style={{ padding: '0 var(--page-px)', paddingBottom: 'var(--tab-bar-pb)' }}>
          <button
            onClick={async () => {
              await signOut()
              router.push('/auth')
            }}
            style={{
              width: '100%', padding: 'var(--space-md)',
              background: 'white', border: '1.5px solid #f0d0d0',
              borderRadius: 'var(--radius-md)', fontSize: 'var(--text-body)', fontWeight: 600,
              color: '#c0392b', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* ── Bottom tab bar ── */}
      <BottomTabBar active="account" />

      {/* ── Toast ── */}
      {toast && (
        <div role="status" aria-live="polite" className="toast gold" style={{ bottom: 'calc(var(--tab-bar-h) + 10px)', zIndex: 200 }}>
          {toast}
        </div>
      )}

    </PhoneFrame>
  )
}
