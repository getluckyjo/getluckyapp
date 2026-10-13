/**
 * GET /.well-known/apple-developer-merchantid-domain-association
 *
 * Apple verifies a domain for Apple Pay by fetching this file. Stitch
 * supplies the file for the merchant identifier it assigned us; its
 * contents go into APPLE_PAY_DOMAIN_ASSOCIATION on Vercel (no code
 * change to rotate it). Without the variable this is a 404, which is
 * what Apple sees for a domain that is not registered.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  const body = (process.env.APPLE_PAY_DOMAIN_ASSOCIATION ?? '').trim()
  if (!body) return new Response('Not found', { status: 404 })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
