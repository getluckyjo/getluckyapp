/**
 * PayFast's REST API, used for saved cards (tokenization), reconciliation
 * and refunds.
 *
 * A golfer who ticked "save my card" at checkout paid with
 * subscription_type=2; PayFast returned a token on the ITN. From then on
 * one server call charges that card: POST /subscriptions/{token}/adhoc.
 * Removing the card is PUT /subscriptions/{token}/cancel. A charge whose
 * answer never came back is looked up in GET /transactions/history, and an
 * admin's refund is POST /refunds/{pf_payment_id}.
 *
 * Every call is signed: MD5 over the alphabetised header fields
 * (merchant-id, version, timestamp), query fields and body fields,
 * URL-encoded the PayFast way, plus the passphrase. The sandbox is the same
 * host with ?testing=true, which is not part of the signature (as in
 * PayFast's own SDK).
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

/** MD5 of the alphabetised headers + query + body + passphrase. Exported for the tests. */
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

/** The signed request, as sent. Throws on timeout or a network failure; a refusal is an answer, not a throw. */
async function send(
  config: ApiConfig,
  method: 'POST' | 'PUT' | 'GET',
  path: string,
  body: Record<string, string>,
  query: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'merchant-id': config.merchantId,
    version: 'v1',
    timestamp: apiTimestamp(),
  }
  headers.signature = apiSignature({ ...headers, ...query, ...body }, config.passphrase)
  const params = new URLSearchParams(query)
  if (config.sandbox) params.set('testing', 'true')
  const qs = params.toString()
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ''}`
  return fetch(url, {
    method,
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

async function call(config: ApiConfig, method: 'POST' | 'PUT' | 'GET', path: string, body: Record<string, string>): Promise<ApiResult> {
  const res = await send(config, method, path, body)
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

// ── Reconciliation ────────────────────────────────────────────────────────

export type TransactionLookup =
  | { found: true; pfPaymentId: string | null; amountCents: number; type: string; date: string }
  | { found: false }

/** One CSV row, quotes and all (PayFast quotes names and the balance's thousands separator). */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

/** YYYY-MM-DD in UTC. */
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Find our payment in PayFast's transaction history. Used when a saved-card
 * charge got no answer: the history says whether the money moved.
 *
 * The window runs from the day before the charge to the day after today, so
 * a charge near midnight in either time zone is inside it. PayFast answers
 * {"response": "<csv>"}; the CSV carries "M Payment ID", "PF Payment ID",
 * "Type" and "Gross". Anything that is not that CSV (an error body, an
 * empty answer, an HTTP failure) throws, so a caller can never read "PayFast
 * did not reply properly" as "the money was not taken".
 */
export async function queryTransaction(config: ApiConfig, mPaymentId: string, opts: { chargedAt: Date; now?: Date }): Promise<TransactionLookup> {
  const now = opts.now ?? new Date()
  const from = isoDate(new Date(opts.chargedAt.getTime() - 86_400_000))
  const to = isoDate(new Date(now.getTime() + 86_400_000))
  const rows = await listTransactions(config, { from, to })
  const row = rows.find(r => r.mPaymentId === mPaymentId)
  if (row) {
    const lookup: TransactionLookup = { found: true, pfPaymentId: row.pfPaymentId, amountCents: row.amountCents, type: row.type, date: row.date }
    log.info('payfast.transaction.found', { m_payment_id: mPaymentId, pf_payment_id: row.pfPaymentId, amount_cents: row.amountCents, type: row.type })
    return lookup
  }
  log.info('payfast.transaction.not_found', { m_payment_id: mPaymentId, from, to, rows: rows.length })
  return { found: false }
}

/** One line of PayFast's transaction history, as far as the ledger cares. */
export interface HistoryRow {
  mPaymentId: string
  pfPaymentId: string | null
  amountCents: number
  type: string
  date: string
  /** custom_str1..4 as the checkout sent them: user id, course id, hole id, tier. */
  custom: { str1: string | null; str2: string | null; str3: string | null; str4: string | null }
}

/**
 * Every transaction PayFast has for us between two dates (YYYY-MM-DD,
 * inclusive), newest or oldest first as PayFast chooses. Anything that is
 * not the transaction CSV (an error body, an empty answer, an HTTP failure)
 * throws, so a caller can never read "PayFast did not reply properly" as
 * "nothing happened".
 */
export async function listTransactions(config: ApiConfig, range: { from: string; to: string }): Promise<HistoryRow[]> {
  const res = await send(config, 'GET', '/transactions/history', {}, { from: range.from, to: range.to })
  const text = await res.text()
  if (!res.ok) throw new Error(`transactions/history answered ${res.status}`)

  let csv = text
  try {
    const json = JSON.parse(text) as { response?: unknown; data?: { response?: unknown } }
    const inner = typeof json?.response === 'string' ? json.response : json?.data?.response
    if (typeof inner === 'string') csv = inner
    else throw new Error('transactions/history answered JSON without a CSV response')
  } catch (err) {
    // Not JSON at all: PayFast may answer the CSV as is.
    if (err instanceof SyntaxError) csv = text
    else throw err
  }

  const lines = csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const header = lines.length ? parseCsvLine(lines[0]).map(h => h.trim().toLowerCase()) : []
  const col = (name: string) => header.indexOf(name)
  const iRef = col('m payment id'), iPf = col('pf payment id'), iType = col('type'), iGross = col('gross'), iDate = col('date')
  const iStr = [1, 2, 3, 4].map(n => col(`custom str${n}`))
  if (iRef === -1 || iGross === -1) throw new Error('transactions/history answered something other than the transaction CSV')

  const cell = (cells: string[], i: number) => (i === -1 ? '' : (cells[i] ?? '').trim())
  const rows: HistoryRow[] = []
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line)
    const mPaymentId = cell(cells, iRef)
    if (!mPaymentId) continue
    const gross = parseFloat(cell(cells, iGross).replace(/,/g, ''))
    rows.push({
      mPaymentId,
      pfPaymentId: cell(cells, iPf) || null,
      amountCents: Number.isFinite(gross) ? Math.round(Math.abs(gross) * 100) : NaN,
      type: cell(cells, iType),
      date: cell(cells, iDate),
      custom: { str1: cell(cells, iStr[0]) || null, str2: cell(cells, iStr[1]) || null, str3: cell(cells, iStr[2]) || null, str4: cell(cells, iStr[3]) || null },
    })
  }
  return rows
}

// ── Refunds ───────────────────────────────────────────────────────────────

export interface RefundResult extends ApiResult {
  /** PayFast's id for the refund, when its answer carries one. */
  refundId: string | null
}

/**
 * Ask PayFast to refund a payment to the card or account it came from.
 * `amountCents` is sent as PayFast's `amount`, which its API takes in cents
 * (a partial or the full amount). The buyer is told by PayFast.
 */
export async function refundPayment(config: ApiConfig, pfPaymentId: string, amountCents: number, reason: string): Promise<RefundResult> {
  const result = await call(config, 'POST', `/refunds/${encodeURIComponent(pfPaymentId)}`, {
    amount: String(Math.round(amountCents)),
    reason,
    notify_buyer: '1',
    notify_merchant: '0',
  })
  const response = (result.raw as { data?: { response?: unknown } } | null)?.data?.response
  const refundId = response && typeof response === 'object'
    ? String((response as { refund_id?: unknown; id?: unknown }).refund_id ?? (response as { id?: unknown }).id ?? '') || null
    : null
  log.info('payfast.refund.requested', { pf_payment_id: pfPaymentId, amount_cents: amountCents, ok: result.ok, status: result.status, code: result.code, message: result.message, refund_id: refundId })
  return { ...result, refundId }
}
