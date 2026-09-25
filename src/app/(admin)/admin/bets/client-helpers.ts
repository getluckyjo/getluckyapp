/**
 * What the Bets and Payments pages share: reading an admin API answer so a
 * failure is never shown as an empty list, downloading a CSV export, and
 * dates in South African time whatever the admin's own clock says.
 */

/** A failed admin API call: the HTTP status (0 when the server was not reached) and what the server said. */
export class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** What the server said went wrong, with its request id for support when there is one. */
async function failureOf(res: Response): Promise<RequestError> {
  const json = await res.json().catch(() => ({})) as { error?: string; requestId?: string }
  const message = json.error ?? `The server answered ${res.status}.`
  return new RequestError(json.requestId ? `${message} Reference ${json.requestId}.` : message, res.status)
}

/** GET an admin API and read its JSON; throws a RequestError on any failure, so an error cannot read as "nothing found". */
export async function getJson<T>(url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store' })
  } catch {
    throw new RequestError('The server could not be reached. Check your connection.', 0)
  }
  if (!res.ok) throw await failureOf(res)
  return res.json() as Promise<T>
}

export type ExportResult = { ok: true; rows: number; cappedAt: number | null } | { ok: false; error: string }

/**
 * Download a CSV from POST /api/admin/export, with the list's filters in
 * `body`. The file is saved only when the server sent one (a failure's JSON
 * used to be saved as a .csv), under the server's name, dated in South
 * African time.
 */
export async function downloadExport(body: { type: string } & Record<string, unknown>): Promise<ExportResult> {
  try {
    const res = await fetch('/api/admin/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return { ok: false, error: (await failureOf(res)).message }
    const blob = await res.blob()
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `${body.type}-export.csv`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Some browsers start the download after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    const capped = res.headers.get('X-Export-Capped')
    return { ok: true, rows: Number(res.headers.get('X-Export-Rows') ?? 0), cappedAt: capped ? Number(capped) : null }
  } catch {
    return { ok: false, error: 'The export did not finish. Check your connection and try again.' }
  }
}

/** "17 Sep 2026, 10:00" in South African time. */
export function sastDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
}

/** "17 Sep 2026" in South African time. */
export function sastDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric' })
}
