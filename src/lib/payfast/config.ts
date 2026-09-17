/**
 * PayFast configuration, resolved per request and validated.
 *
 * Before Batch 3 both PayFast routes read their config at module load with
 * PayFast's public sandbox merchant as the fallback and sandbox as the
 * default. A production deployment with one missing variable therefore took
 * "payments" from the shared sandbox account and handed out real bets.
 *
 * Now there are no fallback credentials, and production refuses to run in
 * sandbox at all. Previews and local dev default to sandbox and need real
 * sandbox credentials of their own.
 */

export interface PayfastConfig {
  merchantId: string
  merchantKey: string
  passphrase: string
  sandbox: boolean
  siteUrl: string
  /** Onsite Payments: the identifier endpoint and the modal script. */
  onsiteProcessUrl: string
  onsiteEngineUrl: string
  processUrl: string
  validateUrl: string
}

export type PayfastConfigResult =
  | { ok: true; config: PayfastConfig }
  | { ok: false; reason: string }

export function isProduction(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'production'
}

export function payfastSandbox(env: Record<string, string | undefined> = process.env): boolean {
  return (env.PAYFAST_SANDBOX ?? 'true').trim() !== 'false'
}

export function resolvePayfastConfig(env: Record<string, string | undefined> = process.env): PayfastConfigResult {
  const merchantId = (env.PAYFAST_MERCHANT_ID ?? '').trim()
  const merchantKey = (env.PAYFAST_MERCHANT_KEY ?? '').trim()
  const passphrase = (env.PAYFAST_PASSPHRASE ?? '').trim()
  const sandbox = payfastSandbox(env)
  const production = isProduction(env)
  const siteUrl = (env.NEXT_PUBLIC_SITE_URL ?? (production ? '' : 'http://localhost:3000')).trim().replace(/\/$/, '')

  const problems: string[] = []
  if (!merchantId || !merchantKey) problems.push('PAYFAST_MERCHANT_ID and PAYFAST_MERCHANT_KEY must be set (no built-in fallback)')
  if (production && sandbox) problems.push('PAYFAST_SANDBOX must be exactly "false" in production')
  if (production && !passphrase) problems.push('PAYFAST_PASSPHRASE must be set in production')
  if (!siteUrl) problems.push('NEXT_PUBLIC_SITE_URL must be set in production')
  if (!sandbox && merchantId === '10000100') problems.push('PAYFAST_MERCHANT_ID is the shared sandbox merchant; live mode needs your own')

  if (problems.length) return { ok: false, reason: problems.join('; ') }

  const host = sandbox ? 'https://sandbox.payfast.co.za' : 'https://www.payfast.co.za'
  return {
    ok: true,
    config: {
      merchantId, merchantKey, passphrase, sandbox, siteUrl,
      processUrl: `${host}/eng/process`,
      validateUrl: `${host}/eng/query/validate`,
      onsiteProcessUrl: `${host}/onsite/process`,
      onsiteEngineUrl: `${host}/onsite/engine.js`,
    },
  }
}
