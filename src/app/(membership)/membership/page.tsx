'use client'

import { Check } from 'lucide-react'
import PhoneFrame from '@/components/layout/PhoneFrame'
import BottomTabBar from '@/components/layout/BottomTabBar'
import AppHeader from '@/components/layout/AppHeader'
import MemberBadge from '@/components/membership/MemberBadge'
import { useMembership } from '@/hooks/useMembership'
import { MEMBERSHIP_PLANS, MEMBERSHIP_PERKS, MEMBERSHIP_FUNNEL_URL } from '@/lib/membership'
import { formatRand } from '@/lib/format'

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

/**
 * Club — the Get Lucky Golf Club in the V2 system.
 * Non-members see the two plans as white tiles, the perks with lime checks,
 * and one lime JOIN that hands off to the funnel. Members see their status
 * in a green card with a quiet manage link, then the perks they already have.
 */
export default function MembershipPage() {
  const { isMember, plan, joinedDate, foundingMember, loading } = useMembership()

  return (
    <PhoneFrame statusTheme="dark">
      <div className="v2-screen">
        <AppHeader tone="light" />

        <div className="vf-scroll">
          <h1 className="v2-title" style={{ marginBottom: 8 }}>{'Get Lucky\nGolf Club'}</h1>
          <p className="vf-sub">
            {isMember
              ? 'Thanks for being a member. Here’s your status and what it gets you.'
              : 'Join the club for status, perks and a fully insured shot at glory.'}
          </p>

          {loading ? (
            <div className="club-plans" aria-hidden>
              <div className="club-plan skeleton" style={{ minHeight: 108 }} />
              <div className="club-plan skeleton" style={{ minHeight: 108 }} />
            </div>
          ) : isMember ? (
            <div className="club-status">
              <div className="club-status-top">
                <span className="club-status-label">Your membership</span>
                <MemberBadge size="sm" />
              </div>
              <dl className="club-rows">
                <div><dt>Status</dt><dd>Active</dd></div>
                <div><dt>Plan</dt><dd>{planLabel(plan)}</dd></div>
                <div><dt>Member since</dt><dd>{formatDate(joinedDate)}</dd></div>
                {foundingMember && <div><dt>Tier</dt><dd>Founding member</dd></div>}
              </dl>
              <a href={MEMBERSHIP_FUNNEL_URL} target="_blank" rel="noopener noreferrer" className="btn-tile btn-tile--block club-manage">
                Manage membership
              </a>
            </div>
          ) : (
            <div className="club-plans">
              {(['monthly', 'annual'] as const).map(p => {
                const pc = MEMBERSHIP_PLANS[p]
                const best = p === 'annual'
                return (
                  <div key={p} className={`club-plan${best ? ' is-best' : ''}`}>
                    {best && <span className="club-plan-flag">Best value</span>}
                    <span className="club-plan-name">{pc.label}</span>
                    <span className="club-plan-price">{formatRand(pc.priceZAR)}</span>
                    <span className="club-plan-cadence">{pc.cadence}</span>
                  </div>
                )
              })}
            </div>
          )}

          <section className="club-perks">
            <h2 className="club-perks-title">{isMember ? 'Your benefits' : 'What you get'}</h2>
            <ul>
              {MEMBERSHIP_PERKS.map(perk => (
                <li key={perk}>
                  <span className="club-check" aria-hidden><Check size={13} strokeWidth={3.2} /></span>
                  <span>{perk}</span>
                </li>
              ))}
            </ul>
          </section>

          {!isMember && !loading && (
            <div className="club-cta">
              <a href={MEMBERSHIP_FUNNEL_URL} target="_blank" rel="noopener noreferrer" className="btn-lime btn-lime--block">
                Join the club
              </a>
              <p className="club-legal">
                Secure signup at membership.getluckygolfclub.com
                <br />
                Prizes fully insured · Underwritten by Indwe Risk Services
              </p>
            </div>
          )}
        </div>

        <BottomTabBar active="membership" />
      </div>
    </PhoneFrame>
  )
}
