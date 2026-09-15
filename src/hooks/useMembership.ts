'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'

export interface MembershipState {
  /** True when the funnel's `members` row for this user is an active member. */
  isMember: boolean
  /** Raw funnel subscription_status (lowercased), or 'none' / 'unknown'. */
  status: string
  /** Funnel plan_type, verbatim (e.g. 'monthly', 'annual', or whatever the funnel stores). */
  plan: string | null
  /** When they joined the club (members.joined_date). */
  joinedDate: string | null
  cancelledDate: string | null
  foundingMember: boolean
  /** True while the status lookup is in flight. */
  loading: boolean
}

const NON_MEMBER: Omit<MembershipState, 'loading'> = {
  isMember: false,
  status: 'none',
  plan: null,
  joinedDate: null,
  cancelledDate: null,
  foundingMember: false,
}

/**
 * Reads the signed-in user's membership status from the external funnel's
 * `members` table via the read-only `/api/membership/status` endpoint.
 *
 * Membership is owned/billed by the funnel (membership.getluckygolfclub.com);
 * this app only reflects status and hands new signups off to the funnel — it
 * never writes to the billing tables.
 */
export function useMembership(): MembershipState {
  const { user } = useAuth()
  const [state, setState] = useState<MembershipState>({ ...NON_MEMBER, loading: true })

  useEffect(() => {
    if (!user) return

    let cancelled = false

    fetch('/api/membership/status')
      .then(res => (res.ok ? res.json() : NON_MEMBER))
      .then(data => {
        if (!cancelled) setState({ ...NON_MEMBER, ...data, loading: false })
      })
      .catch(() => {
        if (!cancelled) setState({ ...NON_MEMBER, loading: false })
      })

    return () => { cancelled = true }
  }, [user])

  // Signed out: nothing to look up, so never "loading". Derived rather than
  // set in the effect, which is what react-hooks/set-state-in-effect objects to.
  if (!user) return { ...NON_MEMBER, loading: false }
  return state
}
