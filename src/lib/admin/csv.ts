/**
 * CSV for the admin exports. Every cell is quoted, quotes are doubled, and a
 * cell that starts with a formula trigger (= + - @ tab CR) is prefixed with
 * an apostrophe so a spreadsheet will not execute it.
 */
export function toCSV(headers: string[], rows: string[][]): string {
  const escape = (v: string) => {
    let safe = v.replace(/"/g, '""')
    if (/^[=+\-@\t\r]/.test(safe)) safe = `'${safe}`
    return `"${safe}"`
  }
  const lines = [headers.map(escape).join(',')]
  rows.forEach(row => lines.push(row.map(v => escape(String(v ?? ''))).join(',')))
  return lines.join('\n')
}
