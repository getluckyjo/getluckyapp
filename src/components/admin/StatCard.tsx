'use client'

import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  title: string
  value: string
  icon: LucideIcon
  /** Kept for callers; the app's look sets every stat in its own green and lime. */
  accent?: string
  subtitle?: string
}

/** One number on the dashboard, in the app's look: a white card, a lime disc, the figure in Poster Gothic. */
export default function StatCard({ title, value, icon: Icon, subtitle }: StatCardProps) {
  return (
    <div className="adm-card" style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flex: 1, minWidth: 210 }}>
      <span aria-hidden style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--lime)', color: 'var(--green-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={21} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="adm-stat-label">{title}</div>
        <div className="adm-stat-value" style={{ fontSize: 30, marginTop: 4 }}>{value}</div>
        {subtitle && <div className="adm-small" style={{ marginTop: 4 }}>{subtitle}</div>}
      </div>
    </div>
  )
}
