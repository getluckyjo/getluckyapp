import { resolve4 } from 'node:dns/promises'

/**
 * PayFast's ITN source addresses. The ITN handler rejects (403) any
 * notification in live mode whose forwarded chain has none of these.
 *
 * Two layers, because PayFast has added addresses without updating the
 * published ranges before (16 Sep 2026: the first ITN for a real payment
 * came from 13.245.74.88, an address w1w.payfast.co.za resolves to, and was
 * refused; PayFast's retry from a listed address is the only reason the
 * payment was recorded):
 *
 *   1. The static list below, PayFast's published ranges plus addresses
 *      seen and confirmed against their hostnames.
 *      Ref: https://support.payfast.co.za/portal/en/kb/articles/what-ip-addresses-does-payfast-use
 *        197.97.145.144/28  → .144 – .159   (16)
 *        41.74.179.192/27   → .192 – .223   (32)
 *        102.216.36.0/28    → .0   – .15    (16)
 *        102.216.36.128/28  → .128 – .143   (16)
 *        144.126.193.139    → single IP
 *        13.245.74.88       → w1w.payfast.co.za, observed 2026-09-16
 *   2. What PayFast's own hostnames resolve to right now, which is the
 *      check their integration guide recommends. Resolved once per
 *      instance, re-resolved every ten minutes, never blocks for more than
 *      a second and a half; a DNS failure simply falls back to the list.
 *
 * The IP check is defence in depth: the signature and the server-side
 * validate call are what prove an ITN genuine.
 */
export const PAYFAST_IPS: ReadonlySet<string> = new Set([
  ...Array.from({ length: 16 }, (_, i) => `197.97.145.${144 + i}`),
  ...Array.from({ length: 32 }, (_, i) => `41.74.179.${192 + i}`),
  ...Array.from({ length: 16 }, (_, i) => `102.216.36.${i}`),
  ...Array.from({ length: 16 }, (_, i) => `102.216.36.${128 + i}`),
  '144.126.193.139',
  '13.245.74.88',
])

/** The hostnames PayFast documents as ITN sources. */
export const PAYFAST_HOSTS = ['www.payfast.co.za', 'w1w.payfast.co.za', 'w2w.payfast.co.za', 'sandbox.payfast.co.za'] as const

/** True when any address in the forwarded chain is on the static list. */
export function isFromPayfast(addresses: string[]): boolean {
  return addresses.some(ip => PAYFAST_IPS.has(ip.trim()))
}

const RESOLVE_TTL_MS = 10 * 60 * 1000
const RESOLVE_TIMEOUT_MS = 1500

type Resolver = (host: string) => Promise<string[]>
let resolved: { at: number; ips: Set<string> } | null = null

/**
 * The static list plus whatever PayFast's hostnames resolve to. `resolver`
 * is injectable for tests; under vitest the live lookup is skipped unless
 * one is given, so route tests never touch the network.
 */
export async function resolvePayfastIps(resolver?: Resolver): Promise<ReadonlySet<string>> {
  const now = Date.now()
  if (resolved && now - resolved.at < RESOLVE_TTL_MS) return resolved.ips
  const lookup: Resolver | null = resolver ?? (process.env.VITEST ? null : resolve4)
  const ips = new Set(PAYFAST_IPS)
  if (lookup) {
    const timeout = new Promise<string[]>(resolve => setTimeout(() => resolve([]), RESOLVE_TIMEOUT_MS))
    const results = await Promise.all(
      PAYFAST_HOSTS.map(host => Promise.race([lookup(host).catch(() => [] as string[]), timeout])),
    )
    for (const list of results) for (const ip of list) ips.add(ip)
  }
  resolved = { at: now, ips }
  return ips
}

/** For tests: forget the cached resolution. */
export function resetResolvedPayfastIps() { resolved = null }

/**
 * True when any address in the forwarded chain is PayFast's, by the static
 * list or by what their hostnames resolve to.
 */
export async function isFromPayfastLive(addresses: string[], resolver?: Resolver): Promise<boolean> {
  if (isFromPayfast(addresses)) return true
  const ips = await resolvePayfastIps(resolver)
  return addresses.some(ip => ips.has(ip.trim()))
}
