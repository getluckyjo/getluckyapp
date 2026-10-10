/**
 * Cloudflare Turnstile on the sign-in screen, as Supabase Auth checks it
 * (Authentication → Attack Protection → Turnstile, with the secret key set
 * there). The site key lives in NEXT_PUBLIC_TURNSTILE_SITE_KEY; without it
 * nothing changes: no script, no widget, no token.
 *
 * Nothing here imports server or browser code, so the screen, the context
 * and the tests share it.
 */

/** Cloudflare's script, loaded once as a plain tag; it defines window.turnstile. */
export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

/**
 * The site key, when Turnstile is on. The default reads the variable by its
 * full name, which is how Next inlines a NEXT_PUBLIC_ value for the browser.
 */
export function turnstileSiteKey(
  env: { NEXT_PUBLIC_TURNSTILE_SITE_KEY?: string } = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY },
): string | null {
  const key = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()
  return key ? key : null
}

/**
 * The captcha token as Supabase's sign-in options take it: present only
 * when there is one, so a screen without Turnstile sends exactly what it
 * sent before.
 */
export function captchaOptions(token: string | null | undefined): { captchaToken: string } | Record<string, never> {
  return token ? { captchaToken: token } : {}
}
