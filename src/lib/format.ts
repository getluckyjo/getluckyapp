/**
 * Display helpers shared by the player app and the admin panel.
 * (Each of these used to exist as two to four private copies.)
 */

/**
 * Whole rand with non-breaking-space thousands: 25000 → "R25 000".
 * Grouped by hand rather than via toLocaleString('en-ZA'), whose separator
 * differs between ICU builds (comma on some, U+00A0 on others); this is the
 * U+00A0 output that Chrome and Node already produced, made deterministic.
 */
export function formatRand(rand: number): string {
  const whole = Math.round(Math.abs(rand)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')
  return `${rand < 0 ? '-' : ''}R${whole}`
}

/** Cents → whole rand: 2_500_000 → "R25 000". */
export function formatRandFromCents(cents: number): string {
  return formatRand(Math.round(cents / 100))
}

/** Cents for the admin panel, decimals only when present: 5000 → "R50", 5049 → "R50,49" (en-ZA). */
export function formatZAR(cents: number): string {
  return `R${(cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 0 })}`
}

/** Up to two initials from a name, else the first letter of the email, else "GL". */
export function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  if (name) return name.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase().slice(0, 2)
  if (email) return email[0].toUpperCase()
  return 'GL'
}

/** Admin timestamps: "just now", "5m ago", "3h ago", "2d ago", then "14 Aug" after a week ("14 Aug 2025" from another year), in South African time. */
export function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const date = new Date(dateStr)
  const year = (d: Date) => d.toLocaleDateString('en-ZA', { year: 'numeric', timeZone: 'Africa/Johannesburg' })
  return date.toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', timeZone: 'Africa/Johannesburg',
    ...(year(date) === year(new Date()) ? {} : { year: 'numeric' }),
  })
}
