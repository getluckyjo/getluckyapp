/**
 * PayFast's published ITN source addresses. The ITN handler rejects (403)
 * any notification in live mode whose forwarded chain has none of these.
 *
 * Ref: https://support.payfast.co.za/portal/en/kb/articles/what-ip-addresses-does-payfast-use
 *   197.97.145.144/28  → .144 – .159   (16)
 *   41.74.179.192/27   → .192 – .223   (32)
 *   102.216.36.0/28    → .0   – .15    (16)
 *   102.216.36.128/28  → .128 – .143   (16)
 *   144.126.193.139    → single IP
 *
 * If PayFast adds a range, real payments start failing with
 * `payfast.itn.rejected_ip` in the logs; add it here.
 */
export const PAYFAST_IPS: ReadonlySet<string> = new Set([
  ...Array.from({ length: 16 }, (_, i) => `197.97.145.${144 + i}`),
  ...Array.from({ length: 32 }, (_, i) => `41.74.179.${192 + i}`),
  ...Array.from({ length: 16 }, (_, i) => `102.216.36.${i}`),
  ...Array.from({ length: 16 }, (_, i) => `102.216.36.${128 + i}`),
  '144.126.193.139',
])

/** True when any address in the forwarded chain is PayFast's. */
export function isFromPayfast(addresses: string[]): boolean {
  return addresses.some(ip => PAYFAST_IPS.has(ip.trim()))
}
