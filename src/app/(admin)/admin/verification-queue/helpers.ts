/**
 * Small helpers the queue and the claim review page share.
 */
import { sastDate, sastDateTime } from '../bets/client-helpers'

/** A time in South African time, whatever the reviewer's computer is set to: "17 Sep 2026, 10:00"; a dash when unknown. */
export function whenSA(iso: string | null | undefined): string {
  return iso ? sastDateTime(iso) : '—'
}

/** A date in South African time: "17 Sep 2026"; a dash when unknown. */
export function daySA(iso: string | null | undefined): string {
  return iso ? sastDate(iso) : '—'
}

/** What to say when an admin request fails: plain words for the common cases, else the server's own message. */
export function failureMessage(status: number, serverError?: string | null): string | null {
  if (status === 401) return 'Your session has ended. Sign in again, then try again.'
  if (status === 403) return 'This account is not an admin.'
  if (status === 429) return 'Too many requests in a short time. Wait a minute, then try again.'
  return serverError ?? null
}
