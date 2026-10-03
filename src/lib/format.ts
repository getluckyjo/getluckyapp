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

/**
 * A prize in whole units of its currency. Rand as formatRand ("R100 000");
 * dollars as an American golfer reads them ("$5,695"). Only a golf trip's
 * prize is ever in dollars (migration 033); every other prize is rand.
 */
export function formatPrize(amount: number, currency: 'ZAR' | 'USD' = 'ZAR'): string {
  if (currency === 'ZAR') return formatRand(amount)
  const whole = Math.round(Math.abs(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${amount < 0 ? '-' : ''}$${whole}`
}

/** A bet's prize in cents of its currency (bets.prize_currency), for the admin panel: "R25 000", "$5,695". */
export function formatMoney(cents: number, currency: 'ZAR' | 'USD' | string | null | undefined = 'ZAR'): string {
  if (currency !== 'USD') return formatZAR(cents)
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
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
