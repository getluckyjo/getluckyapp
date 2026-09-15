import * as Sentry from '@sentry/nextjs'

/**
 * Next.js instrumentation hook: runs once per server instance at start-up.
 *
 * Loads the Sentry runtime config and then checks the environment is sane.
 * A preview deployment pointed at the production database, or a preview
 * that thinks it is taking real money, is refused here rather than
 * discovered later.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('../sentry.server.config')
  if (process.env.NEXT_RUNTIME === 'edge') await import('../sentry.edge.config')
  guardEnvironment()
}

export const onRequestError = Sentry.captureRequestError

const PRODUCTION_SUPABASE_REF = 'ajsgzeofswlizwwdkesp'

/**
 * Exported for tests. Throws on a configuration that must never run.
 */
export function guardEnvironment(env: Record<string, string | undefined> = process.env) {
  const vercelEnv = env.VERCEL_ENV
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const payfastSandbox = (env.PAYFAST_SANDBOX ?? 'true').trim() !== 'false'

  if (vercelEnv === 'preview' || vercelEnv === 'development') {
    const problems: string[] = []
    if (supabaseUrl.includes(PRODUCTION_SUPABASE_REF)) {
      problems.push(`NEXT_PUBLIC_SUPABASE_URL points at the PRODUCTION Supabase project (${PRODUCTION_SUPABASE_REF})`)
    }
    if (!payfastSandbox) {
      problems.push('PAYFAST_SANDBOX is "false": a preview would take real money')
    }
    if (problems.length) {
      const message = `Refusing to start a ${vercelEnv} deployment: ${problems.join('; ')}. ` +
        'Set the Preview environment variables in Vercel to the staging project (docs/stage-2-safety-net.md).'
      console.error(message)
      Sentry.captureMessage(message, 'fatal')
      throw new Error(message)
    }
  }

  if (vercelEnv === 'production' && payfastSandbox) {
    // A sandbox "payment" costs nothing and would create a real bet with a
    // real prize. The PayFast routes also refuse per request (503); this
    // makes the deployment itself fail so it is impossible to miss.
    const message = 'Refusing to start PRODUCTION with PayFast in SANDBOX mode: set PAYFAST_SANDBOX=false and live merchant credentials.'
    console.error(message)
    Sentry.captureMessage(message, 'fatal')
    throw new Error(message)
  }
}
