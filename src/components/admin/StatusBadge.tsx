'use client'

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'gold'

/** Each variant as one of the admin's pills (admin.css): the app's lime for done, green for in hand. */
const VARIANT_CLASS: Record<BadgeVariant, string> = {
  success: 'adm-pill adm-pill--lime',
  warning: 'adm-pill adm-pill--amber',
  danger: 'adm-pill adm-pill--red',
  info: 'adm-pill adm-pill--green',
  neutral: 'adm-pill',
  gold: 'adm-pill adm-pill--gold',
}

// Status → variant mapping
const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  active: 'info',
  miss: 'neutral',
  claimed: 'gold',
  verified: 'success',
  paid: 'success',
  pending: 'warning',
  documents_received: 'gold',
  under_review: 'info',
  approved: 'success',
  rejected: 'danger',
}

interface StatusBadgeProps {
  status: string
  variant?: BadgeVariant
  small?: boolean
}

export default function StatusBadge({ status, variant, small }: StatusBadgeProps) {
  const v = variant || STATUS_VARIANTS[status] || 'neutral'
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  return (
    <span className={VARIANT_CLASS[v]} style={small ? { padding: '2px 8px', fontSize: 11 } : undefined}>
      {label}
    </span>
  )
}
