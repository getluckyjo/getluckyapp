/**
 * Get Lucky Club membership ITNs that reach this app instead of their own.
 *
 * The PayFast merchant account is shared with the membership site
 * (membership.getluckygolfclub.com), whose monthly subscriptions carry GLG-…
 * references. Its checkout names its own notify_url, but the recurring ITN for
 * each renewal comes to the account's Notify URL, which go-live pointed at this
 * app (docs/payfast-go-live.md, step 1). From at least 18 Sep 2026 every
 * renewal arrived here, failed the ledger write (custom_str1 is a club slug,
 * not a user id), answered 500 and was retried all day, while the membership
 * site recorded none of them.
 *
 * A membership payment is not ours to record. Once the route has proved the
 * ITN genuine it is handed on unchanged to the membership webhook, and PayFast
 * gets that webhook's answer, so it retries only if the membership site did
 * not take it.
 *
 * The membership webhook checks, as an advisory, that an ITN came from a
 * PayFast address, and emails ops when it did not. A relayed ITN comes from
 * this app, so the PayFast address it arrived from travels with it in
 * `X-PayFast-Source-IP` for that check to use instead.
 */

export const MEMBERSHIP_ITN_URL = 'https://membership.getluckygolfclub.com/api/webhooks/payfast'

/** How long the membership webhook gets before PayFast is told to retry. */
const RELAY_TIMEOUT_MS = 10_000

export function isMembershipReference(mPaymentId: string): boolean {
  return mPaymentId.startsWith('GLG-')
}

export type MembershipRelayResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; detail: string }

export async function relayMembershipItn(rawBody: string, sourceIp: string): Promise<MembershipRelayResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS)
  try {
    const res = await fetch(MEMBERSHIP_ITN_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(sourceIp ? { 'X-PayFast-Source-IP': sourceIp } : {}),
      },
      body:    rawBody,
      signal:  controller.signal,
    })
    if (res.ok) return { ok: true, status: res.status }
    const text = (await res.text().catch(() => '')).trim().slice(0, 120)
    return { ok: false, status: res.status, detail: `HTTP ${res.status}${text ? `: ${text}` : ''}` }
  } catch (err) {
    return { ok: false, status: null, detail: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}
