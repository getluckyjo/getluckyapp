'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard,
  ClipboardCheck,
  Ticket,
  CreditCard,
  Users,
  MapPin,
  BarChart3,
  KeyRound,
  Star,
  TicketPercent,
  Flag,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useState } from 'react'

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/verification-queue', label: 'Verification Queue', icon: ClipboardCheck, badge: true },
  { href: '/admin/bets', label: 'Bets', icon: Ticket },
  { href: '/admin/payments', label: 'Payments', icon: CreditCard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/courses', label: 'Courses', icon: MapPin },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { href: '/admin/icons', label: 'Icons', icon: Star },
  { href: '/admin/promos', label: 'Promo codes', icon: TicketPercent },
  { href: '/admin/golf-days', label: 'Golf days', icon: Flag },
  { href: '/admin/beta', label: 'Beta testers', icon: KeyRound },
]

/** Where the desktop sidebar was left, collapsed or not; kept across visits. */
const COLLAPSED_KEY = 'gl_admin_sidebar_collapsed'

export default function AdminSidebar({ pendingClaims = 0, open = false, onClose }: {
  pendingClaims?: number
  /** Open as a drawer (below 900 px wide); on a wide screen the sidebar is always there. */
  open?: boolean
  onClose?: () => void
}) {
  const pathname = usePathname()
  // The admin renders only in the browser (after its access check), so storage can be read here.
  const [collapsedPref, setCollapsedPref] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
  })
  // The drawer always shows its labels.
  const collapsed = collapsedPref && !open
  function setCollapsed(next: boolean) {
    setCollapsedPref(next)
    try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch { /* private window */ }
  }

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  return (
    <aside className={`adm-side${collapsed ? ' adm-side--collapsed' : ''}${open ? ' is-open' : ''}`}>
      <Link href="/admin" className="adm-side-logo" aria-label="Get Lucky admin: dashboard" onClick={onClose}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-corner.svg" alt="Get Lucky" />
        {!collapsed && <span className="adm-side-word">Admin</span>}
      </Link>

      <nav className="adm-nav" aria-label="Admin">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? 'is-active' : undefined}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              onClick={onClose}
            >
              <Icon size={19} aria-hidden />
              {!collapsed && <span>{item.label}</span>}
              {item.badge && pendingClaims > 0 && (
                <span className="adm-count" aria-label={`${pendingClaims} waiting`}>{pendingClaims}</span>
              )}
            </Link>
          )
        })}
      </nav>

      <button
        type="button"
        className="adm-side-toggle"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </aside>
  )
}
