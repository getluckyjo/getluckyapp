/**
 * PayFast's REST API, used for saved cards (tokenization).
 *
 * A golfer who ticked "save my card" at checkout paid with
 * subscription_type=2; PayFast returned a token on the ITN. From then on
 * one server call charges that card: POST /subscriptions/{token}/adhoc.
 * Removing the card is PUT /subscriptions/{token}/cancel.
 *
 * Every call is signed: MD5 over the alphabetised header fields
 * (merchant-id, version, timestamp) and body fields, URL-encoded the PayFast
 * way, plus the passphrase. The sandbox is the same host with ?testing=true.
 */
import { createHash } from 'node:crypto'
import { log } from '@/lib/observability/log'

const API_BASE = 'https://api.payfast.co.za'
const TIMEOUT_MS = 12_000

export interface ApiConfig {
  merchantId: string
  passphrase: string
  sandbox: boolean
}

/** PayFast's encoding: spaces as +, upper-case hex, values trimmed. */
function pfEncode(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%20/g, '+')
}

/** ISO-8601 with a numeric offset, the form PayFast's samples use. */
export function apiTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

/** MD5 of the alphabetised headers + body + passphrase. Exported for the tests. */
export function apiSignature(fields: Record<string, string>, passphrase: string): string {
  const all: Record<string, string> = { ...fields, passphrase }
  const qs = Object.keys(all)
    .sort()
    .filter(k => all[k] !== undefined && all[k] !== '')
    .map(k => `${k}=${pfEncode(all[k])}`)
    .join('&')
  return createHash('md5').update(qs).digest('hex')
}

interface ApiResult {
  ok: boolean
  status: number
  code: number | null
  message: string | null
  /** PayFast's own payment id for a charge, when it says. */
  pfPaymentId: string | null
  raw: unknown
}

async function call(config: ApiConfig, method: 'POST' | 'PUT' | 'GET', path: string, body: Record<string, string>): Promise<ApiResult> {
  const headers: Record<string, string> = {
    'merchant-id': config.merchantId,
    version: 'v1',
    timestamp: apiTimestamp(),
  }
  headers.signature = apiSignature({ ...headers, ...body }, config.passphrase)
  const url = `${API_BASE}${path}${config.sandbox ? '?testing=true' : ''}`
  const res = await fetch(url, {
    method,
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const raw = await res.json().catch(() => null) as { code?: number; status?: string; data?: { message?: string; response?: unknown } } | null
  const data = raw?.data
  const response = data?.response as { pf_payment_id?: string | number } | boolean | undefined
  const pfPaymentId = response && typeof response === 'object' && response.pf_payment_id != null ? String(response.pf_payment_id) : null
  const ok = res.ok && raw?.status === 'success' && response !== false
  return { ok, status: res.status, code: raw?.code ?? null, message: data?.message ?? null, pfPaymentId, raw }
}

/** Charge a saved card. Amount in cents. Our reference rides along so the ITN can be matched. */
export async function chargeToken(
  config: ApiConfig,
  token: string,
  opts: { amountCents: number; itemName: string; mPaymentId: string },
): Promise<ApiResult> {
  const result = await call(config, 'POST', `/subscriptions/${encodeURIComponent(token)}/adhoc`, {
    amount: String(opts.amountCents),
    item_name: opts.itemName,
    m_payment_id: opts.mPaymentId,
  })
  log.info('payfast.token.charge', { m_payment_id: opts.mPaymentId, ok: result.ok, status: result.status, code: result.code, message: result.message })
  return result
}

/** Cancel the ad hoc agreement so the token can never be charged again. */
export async function cancelToken(config: ApiConfig, token: string): Promise<ApiResult> {
  const result = await call(config, 'PUT', `/subscriptions/${encodeURIComponent(token)}/cancel`, {})
  log.info('payfast.token.cancel', { ok: result.ok, status: result.status, code: result.code, message: result.message })
  return result
}
