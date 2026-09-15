/**
 * Renders the auth emails to disk so they can be opened in a browser or an
 * email-preview tool without sending anything.
 *
 *   npx tsx scripts/preview-auth-email.mts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderAuthEmail } from '../src/lib/email/auth-emails'

const outDir = process.argv[2] ?? '/tmp'
mkdirSync(outDir, { recursive: true })

const base = {
  to: 'golfer@example.com',
  token: '482913',
  tokenHash: 'preview-token-hash',
  redirectTo: 'https://www.getluckyholeinone.com/auth/callback?next=/select-course',
}

for (const type of ['magiclink', 'recovery', 'invite', 'email_change', 'reauthentication'] as const) {
  const email = renderAuthEmail({ ...base, type })
  const file = join(outDir, `auth-email-${type}.html`)
  writeFileSync(file, email.html)
  console.log(`${type.padEnd(18)} ${email.subject}\n  → ${file}`)
}
