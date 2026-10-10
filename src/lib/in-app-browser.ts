/**
 * Is this page inside another app's browser?
 *
 * A link tapped in Instagram, Facebook, WhatsApp, TikTok, LinkedIn or the
 * Gmail app opens in that app's embedded web view, not in Safari or Chrome.
 * Google refuses OAuth sign-in there ("disallowed_useragent": the embedded
 * view can be scripted by the host app, so Google will not show its password
 * box inside one). The email code works anywhere, so the sign-in screen
 * hides the Google tile in a web view and says why.
 *
 * The broadcast QR code and the Instagram link both land here, so during
 * the Icons Cup most first visits are exactly this case.
 */
const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|WhatsApp|Line\/|Twitter|TikTok|BytedanceWebview|Snapchat|LinkedInApp|Pinterest|GSA\/|; wv\)/

export function isInAppBrowser(ua: string | undefined | null): boolean {
  return !!ua && IN_APP.test(ua)
}
