'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard,
  ClipboardCheck,
  Ticket,
  Users,
  MapPin,
  BarChart3,
  KeyRound,
  Star,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useState } from 'react'

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/verification-queue', label: 'Verification Queue', icon: ClipboardCheck, badge: true },
  { href: '/admin/bets', label: 'Bets', icon: Ticket },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/courses', label: 'Courses', icon: MapPin },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { href: '/admin/icons', label: 'Icons', icon: Star },
  { href: '/admin/beta', label: 'Beta testers', icon: KeyRound },
]

export default function AdminSidebar({ pendingClaims = 0 }: { pendingClaims?: number }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  return (
    <aside
      style={{
        width: collapsed ? 72 : 250,
        minHeight: '100vh',
        background: '#335231',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s ease',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: collapsed ? '20px 12px' : '20px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minHeight: 64,
        }}
      >
        <span style={{ fontSize: 24 }}>⛳</span>
        {!collapsed && (
          <span
            style={{
              fontFamily: "'Poster Gothic', Georgia, sans-serif",
              fontWeight: 700,
              fontSize: 16,
              color: '#fff',
              whiteSpace: 'nowrap',
            }}
          >
            Get Lucky Admin
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: collapsed ? '10px 14px' : '10px 14px',
                borderRadius: 8,
                background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
                color: active ? '#fff' : 'rgba(255,255,255,0.65)',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                transition: 'all 0.15s ease',
                position: 'relative',
              }}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={20} />
              {!collapsed && <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>}
              {item.badge && pendingClaims > 0 && (
                <span
                  style={{
                    position: collapsed ? 'absolute' : 'relative',
                    top: collapsed ? 4 : undefined,
                    right: collapsed ? 4 : undefined,
                    marginLeft: collapsed ? 0 : 'auto',
                    background: '#c0392b',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 10,
                    padding: '1px 7px',
                    minWidth: 20,
                    textAlign: 'center',
                    lineHeight: '18px',
                  }}
                >
                  {pendingClaims}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          position: 'absolute',
          top: 72,
          right: -14,
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: '#1e3120',
          border: '2px solid rgba(255,255,255,0.15)',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
        }}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </aside>
  )
}
