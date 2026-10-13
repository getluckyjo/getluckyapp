/**
 * Stitch configuration, resolved per request and validated.
 *
 * Stitch (stitch.money) carries Apple Pay and Google Pay for us: the wallet
 * sheet opens on our own page and Stitch decrypts and charges the token.
 * PayFast keeps cards, Instant EFT and the PayFast saved-card one-tap.
 *
 * Test and live are different Stitch clients on the same endpoints, so the
 * only production guard is: no test client in production. A missing
 * variable means "Stitch is off" and the stake sheet shows the PayFast
 * hosted-page Apple Pay button instead; nothing breaks.
 */

export interface StitchConfig {
  clientId: string
  clientSecret: string
  /** Svix signing secret for the transaction webhook (whsec_…). Optional until the subscription exists. */
  webhookSecret: string | null
  /** The Apple Pay merchant identifier Stitch assigned (low-risk web clients) or ours (an Apple developer account). */
  appleMerchantIdentifier: string
  /** What the Apple Pay sheet shows as the payee. */
  displayName: string
  siteUrl: string
  tokenUrl: string
  graphqlUrl: string
}

export type StitchConfigResult =
  | { ok: true; config: StitchConfig }
  | { ok: false; reason: string }

export function isProduction(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === 'production'
}

/** Is Stitch set up at all? The client reads the public half; the server the whole. */
export function stitchEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !!(env.STITCH_CLIENT_ID ?? '').trim() && !!(env.STITCH_CLIENT_SECRET ?? '').trim()
}

export function resolveStitchConfig(env: Record<string, string | undefined> = process.env): StitchConfigResult {
  const clientId = (env.STITCH_CLIENT_ID ?? '').trim()
  const clientSecret = (env.STITCH_CLIENT_SECRET ?? '').trim()
  const webhookSecret = (env.STITCH_WEBHOOK_SECRET ?? '').trim() || null
  const appleMerchantIdentifier = (env.STITCH_APPLE_MERCHANT_IDENTIFIER ?? '').trim()
  const displayName = (env.STITCH_DISPLAY_NAME ?? 'Get Lucky Golf').trim()
  const production = isProduction(env)
  const siteUrl = (env.NEXT_PUBLIC_SITE_URL ?? (production ? '' : 'http://localhost:3000')).trim().replace(/\/$/, '')

  const problems: string[] = []
  if (!clientId || !clientSecret) problems.push('STITCH_CLIENT_ID and STITCH_CLIENT_SECRET must be set')
  if (production && /^test-/i.test(clientId)) problems.push('STITCH_CLIENT_ID is a test client; production needs the live client')
  if (!appleMerchantIdentifier) problems.push('STITCH_APPLE_MERCHANT_IDENTIFIER must be set (Stitch assigns it at onboarding)')
  if (!siteUrl) problems.push('NEXT_PUBLIC_SITE_URL must be set in production')
  if (production && !webhookSecret) problems.push('STITCH_WEBHOOK_SECRET must be set in production (the Svix signing secret)')
  if (problems.length) return { ok: false, reason: problems.join('; ') }

  return {
    ok: true,
    config: {
      clientId, clientSecret, webhookSecret, appleMerchantIdentifier, displayName, siteUrl,
      tokenUrl: 'https://secure.stitch.money/connect/token',
      graphqlUrl: 'https://api.stitch.money/graphql',
    },
  }
}

/** The host Apple Pay sessions must be started from: our own, never a stranger's. */
export function siteHost(config: Pick<StitchConfig, 'siteUrl'>): string {
  try {
    return new URL(config.siteUrl).hostname
  } catch {
    return ''
  }
}
