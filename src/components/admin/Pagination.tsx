'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  onPageChange: (page: number) => void
}

export default function Pagination({ page, totalPages, total, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null

  return (
    <nav aria-label="Pages" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 0', fontSize: 13 }}>
      <span className="adm-muted">{total.toLocaleString('en-ZA')} results</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="adm-icon-btn" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontWeight: 700 }}>Page {page} of {totalPages}</span>
        <button type="button" className="adm-icon-btn" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
    </nav>
  )
}
