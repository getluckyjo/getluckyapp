/**
 * Get Lucky Club membership ITNs that reach this app instead of their own.
 *
 * The PayFast merchant account is shared with the membership site
 * (membership.getluckygolfclub.com), whose monthly subscriptions carry GLG-…
 * references. Its checkout names its own notify_url, but the recurring ITN for
 * each renewal comes to the account's Notify URL, which go-live pointed at this
 * app (docs/payfast-go-live.md, step 1). From at least 18 Sep 2026 every
 * renewal arrived here, failed the ledger write (custom_str1 is a club slug,
 * not a user id), answered 500 and was retried all day, alerting on each try.
 *
 * Memberships are being phased out (Sep 2026) and are not tracked any more.
 * Once the route has proved such an ITN genuine it is acknowledged and nothing
 * else: no ledger row, no alert, no hand-on. PayFast keeps its own record of
 * every payment.
 */
export function isMembershipReference(mPaymentId: string): boolean {
  return mPaymentId.startsWith('GLG-')
}
