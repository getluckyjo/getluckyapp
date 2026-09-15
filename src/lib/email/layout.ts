/**
 * The V2 email shell — the same system as the app: grey surface, white card,
 * brand-green header carrying the Hole-in-1 lockup, lime call-to-action with
 * the hard green offset, Indwe line in the footer.
 *
 * Email clients cannot load Poster Gothic or Inter, so headlines fall back to
 * the heaviest system sans (Arial Black / Impact) set uppercase, and body copy
 * to Arial. Everything is inline-styled tables; nothing depends on <style>.
 */

export const EMAIL_COLORS = {
  green: '#345231',
  greenDark: '#1e3120',
  lime: '#d6fb4b',
  surface: '#ebedea',
  white: '#ffffff',
  text: '#2a2a2a',
  muted: '#5f6b5e',
} as const

const HEAD_FONT = "'Arial Black', Impact, 'Helvetica Neue', Arial, sans-serif"
const BODY_FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.getluckyholeinone.com').replace(/\/$/, '')
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Headline in the app's display voice: uppercase, heavy, tight. */
export function headline(text: string): string {
  return `<h1 style="margin:0 0 14px;font-family:${HEAD_FONT};font-size:30px;line-height:1.1;letter-spacing:0.5px;text-transform:uppercase;color:${EMAIL_COLORS.green};">${text}</h1>`
}

export function paragraph(text: string, opts: { muted?: boolean; size?: number } = {}): string {
  const color = opts.muted ? EMAIL_COLORS.muted : EMAIL_COLORS.text
  const size = opts.size ?? 16
  return `<p style="margin:0 0 16px;font-family:${BODY_FONT};font-size:${size}px;line-height:1.55;color:${color};">${text}</p>`
}

/** The lime button. Bulletproof: a table cell, not a styled anchor. */
export function ctaButton(label: string, href: string): string {
  return `
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:8px 0 24px;">
  <tr>
    <td style="background-color:${EMAIL_COLORS.lime};border-radius:6px;border-right:4px solid ${EMAIL_COLORS.green};border-bottom:5px solid ${EMAIL_COLORS.green};">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:15px 30px;font-family:${HEAD_FONT};font-size:18px;line-height:1;letter-spacing:0.5px;text-transform:uppercase;color:${EMAIL_COLORS.green};text-decoration:none;">${label}</a>
    </td>
  </tr>
</table>`
}

/** A one-time code, set big in a lime block so it can be read off a phone. */
export function codeBlock(code: string): string {
  return `
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:6px 0 22px;">
  <tr>
    <td style="background-color:${EMAIL_COLORS.lime};border-radius:8px;padding:18px 28px;font-family:${HEAD_FONT};font-size:36px;line-height:1;letter-spacing:8px;color:${EMAIL_COLORS.green};">${escapeHtml(code)}</td>
  </tr>
</table>`
}

export function divider(): string {
  return `<hr style="border:none;border-top:1px solid ${EMAIL_COLORS.surface};margin:8px 0 24px;" />`
}

/**
 * Wraps body HTML in the shell. `preheader` is the inbox preview line.
 */
export function emailShell(opts: { title: string; preheader?: string; body: string; footerNote?: string }): string {
  const site = siteUrl()
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(opts.preheader)}${'&nbsp;&zwnj;'.repeat(40)}</div>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLORS.surface};">
  ${preheader}
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background-color:${EMAIL_COLORS.surface};padding:32px 12px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:560px;background-color:${EMAIL_COLORS.white};border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td align="center" style="background-color:${EMAIL_COLORS.green};padding:30px 32px 26px;">
              <img src="${site}/brand/logo-lockup.png" alt="Get Lucky Hole-in-1 Challenge" width="150" style="display:block;width:150px;height:auto;border:0;outline:none;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 12px;">
              ${opts.body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:${EMAIL_COLORS.surface};padding:20px 32px 24px;">
              ${opts.footerNote ? `<p style="margin:0 0 12px;font-family:${BODY_FONT};font-size:13px;line-height:1.5;color:${EMAIL_COLORS.muted};">${opts.footerNote}</p>` : ''}
              <p style="margin:0 0 6px;font-family:${BODY_FONT};font-size:12px;line-height:1.5;color:${EMAIL_COLORS.muted};">
                Get Lucky Golf &middot; Proudly sponsored by Indwe Risk Services, an Authorised Financial Services Provider (FSP 3425).
              </p>
              <p style="margin:0;font-family:${BODY_FONT};font-size:12px;line-height:1.5;color:${EMAIL_COLORS.muted};">
                Real-money play for South African residents aged 18 and over. Play responsibly.
                <a href="${site}/responsible-play" style="color:${EMAIL_COLORS.green};">Responsible play</a> &middot;
                <a href="${site}/privacy" style="color:${EMAIL_COLORS.green};">Privacy</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
