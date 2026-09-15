'use client'

import { Check } from 'lucide-react'
import PhoneFrame from '@/components/layout/PhoneFrame'
import BottomTabBar from '@/components/layout/BottomTabBar'
import AppHeader from '@/components/layout/AppHeader'
import MemberBadge from '@/components/membership/MemberBadge'
import { useMembership } from '@/hooks/useMembership'
import { MEMBERSHIP_PLANS, MEMBERSHIP_PERKS, MEMBERSHIP_FUNNEL_URL } from '@/lib/membership'

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Pretty-print the funnel's plan_type, falling back gracefully. */
function planLabel(plan: string | null) {
  if (!plan) return '—'
  const key = plan.toLowerCase()
  if (key === 'monthly' || key === 'annual') return MEMBERSHIP_PLANS[key].label
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

export default function MembershipPage() {
  const { isMember, status, plan, joinedDate, foundingMember, loading } = useMembership()

  return (
    <PhoneFrame statusTheme="dark" hideSponsor>
      <div style={{ overflowY: 'auto', height: '100%', background: 'var(--cream)' }}>

        {/* ── Hero ── */}
        <div style={{
          position: 'relative',
          background: 'linear-gradient(150deg, #1e3120 0%, var(--green-deep) 55%, #4a7a3d 100%)',
          padding: '0 0 var(--space-xl)',
          color: 'white',
        }}>
          <AppHeader tone="dark" />

          <div style={{ textAlign: 'center', marginTop: 'clamp(8px, 2vh, 18px)', padding: '0 var(--page-px)' }}>
            <MemberBadge style={{ marginBottom: 14 }} />
            <h1 style={{
              fontFamily: 'var(--font-heading)', fontSize: 'clamp(28px, 8.5vw, 36px)',
              fontWeight: 800, lineHeight: 1.1, marginBottom: 8, textTransform: 'uppercase',
            }}>
              Get Lucky Golf Club
            </h1>
            <p style={{ fontSize: 'var(--text-body)', color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>
              {isMember
                ? 'Thanks for being a member. Here’s your status & benefits.'
                : 'Join the club for status, perks & a fully-insured shot at glory.'}
            </p>
          </div>
        </div>

        {/* ── Member status card (active members only) ── */}
        {isMember ? (
          <div style={{ padding: 'var(--space-lg) var(--page-px) 0' }}>
            <div style={{
              background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid #e8e4dc',
              padding: 'var(--space-lg)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
                <div style={{ fontSize: 'var(--text-body)', fontWeight: 700, color: 'var(--green-deep)' }}>
                  Your Membership
                </div>
                <MemberBadge size="sm" />
              </div>
              {[
                { label: 'Status', value: 'Active' },
                { label: 'Plan', value: planLabel(plan) },
                { label: 'Member since', value: formatDate(joinedDate) },
                ...(foundingMember ? [{ label: 'Tier', value: 'Founding Member' }] : []),
              ].map((row, i, arr) => (
                <div key={row.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: 'var(--space-sm) 0',
                  borderBottom: i < arr.length - 1 ? '1px solid #f5f0e8' : 'none',
                }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--gray-light)' }}>{row.label}</span>
                  <span style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--black)' }}>{row.value}</span>
                </div>
              ))}

              <a
                href={MEMBERSHIP_FUNNEL_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block', width: '100%', marginTop: 'var(--space-md)', padding: 'var(--space-sm)',
                  background: 'white', border: '1.5px solid #e0dbd0', borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--green-deep)',
                  textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box',
                }}
              >
                Manage membership →
              </a>
            </div>
          </div>
        ) : (
          /* ── Plan preview (non-members) ── */
          !loading && (
            <div style={{ padding: 'var(--space-lg) var(--page-px) 0' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                {(['monthly', 'annual'] as const).map(p => {
                  const pc = MEMBERSHIP_PLANS[p]
                  return (
                    <div
                      key={p}
                      style={{
                        flex: 1, textAlign: 'left',
                        background: 'white',
                        border: p === 'annual' ? '2px solid var(--gold)' : '1.5px solid #e8e4dc',
                        borderRadius: 'var(--radius-lg)', padding: 'var(--space-md)',
                        position: 'relative',
                      }}
                    >
                      {p === 'annual' && (
                        <span style={{
                          position: 'absolute', top: -9, right: 10, background: 'var(--gold)',
                          color: '#3a2f12', fontSize: 9, fontWeight: 800, padding: '2px 8px',
                          borderRadius: 10, letterSpacing: '0.03em',
                        }}>
                          BEST VALUE
                        </span>
                      )}
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--green-deep)' }}>{pc.label}</div>
                      <div style={{ fontFamily: 'Poster Gothic, sans-serif', fontSize: 'var(--text-xl)', fontWeight: 900, color: 'var(--green-deep)', marginTop: 2 }}>
                        R{pc.priceZAR.toLocaleString('en-ZA')}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-light)' }}>{pc.cadence}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        )}

        {/* ── Perks ── */}
        <div style={{ padding: 'var(--space-lg) var(--page-px) 0' }}>
          <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', border: '1px solid #e8e4dc', padding: 'var(--space-lg)' }}>
            <div style={{ fontSize: 'var(--text-body)', fontWeight: 700, color: 'var(--green-deep)', marginBottom: 'var(--space-md)' }}>
              Member Benefits
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {MEMBERSHIP_PERKS.map(perk => (
                <div key={perk} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{
                    flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
                    background: 'rgba(74,122,61,0.12)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', marginTop: 1,
                  }}>
                    <Check size={13} strokeWidth={3} color="var(--green-mid)" />
                  </span>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--black)', lineHeight: 1.4 }}>{perk}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Sticky CTA (join → external funnel) ── */}
        {!isMember && !loading && (
          <div style={{ padding: 'var(--space-lg) var(--page-px) var(--tab-bar-pb)' }}>
            <a
              href={MEMBERSHIP_FUNNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-gold"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '100%', padding: '16px', fontSize: 'var(--text-base)', fontWeight: 700,
                textDecoration: 'none', boxSizing: 'border-box',
              }}
            >
              Join the Club →
            </a>
            <p style={{ fontSize: 10, color: 'var(--gray-light)', textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
              Secure signup at membership.getluckygolfclub.com
              <br />
              Prizes fully insured · Underwritten by Indwe Risk Services
            </p>
          </div>
        )}

        {(isMember || loading) && <div style={{ height: 'var(--tab-bar-pb)' }} />}
      </div>

      <BottomTabBar active="membership" />
    </PhoneFrame>
  )
}
