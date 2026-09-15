import { emailShell, headline, paragraph, ctaButton, codeBlock, divider, escapeHtml, siteUrl } from './layout'

/** The `email_action_type` values Supabase's Send Email hook can ask for. */
export type AuthEmailType =
  | 'magiclink'
  | 'signup'
  | 'email'
  | 'recovery'
  | 'invite'
  | 'email_change'
  | 'reauthentication'

export interface AuthEmailInput {
  type: AuthEmailType | string
  to: string
  /** Six-digit one-time code. */
  token: string
  /** Hashed token used by the confirm link. */
  tokenHash: string
  /** Where Supabase was asked to land afterwards (may be any host). */
  redirectTo?: string
  /** For email_change: the new address the code confirms. */
  newEmail?: string
  /** For email_change with double confirmation: the token for the new address. */
  tokenNew?: string
  tokenHashNew?: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** Map Supabase's action type onto the `type` verifyOtp expects. */
function otpType(type: string): string {
  switch (type) {
    case 'signup':
    case 'magiclink':
    case 'recovery':
    case 'invite':
    case 'email_change':
      return type
    default:
      return 'email'
  }
}

/** Keep only a path we would honour anyway; the confirm route re-validates. */
function nextPathFrom(redirectTo?: string): string | null {
  if (!redirectTo) return null
  try {
    const url = new URL(redirectTo)
    const next = url.searchParams.get('next')
    return next && next.startsWith('/') ? next : null
  } catch {
    return null
  }
}

function confirmLink(input: AuthEmailInput, tokenHash = input.tokenHash): string {
  const url = new URL('/auth/confirm', siteUrl())
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', otpType(input.type))
  const next = nextPathFrom(input.redirectTo)
  if (next) url.searchParams.set('next', next)
  return url.toString()
}

const IGNORE_NOTE = 'If you didn’t ask for this email you can safely ignore it — nothing happens unless the code or button is used.'

/**
 * Renders the branded email for a Supabase auth event. The six-digit code is
 * the hero: it survives mail-provider link scanners and works when the email
 * is opened on a different device from the one that asked for it. The button
 * is the convenience path.
 */
export function renderAuthEmail(input: AuthEmailInput): RenderedEmail {
  const code = input.token
  const link = confirmLink(input)

  switch (input.type) {
    case 'recovery': {
      const subject = `Reset your Get Lucky password — code ${code}`
      const html = emailShell({
        title: subject,
        preheader: `Your reset code is ${code}. It expires soon.`,
        body:
          headline('Reset your<br/>password') +
          paragraph('Use this code on the reset screen, or tap the button to open it on this device.') +
          codeBlock(code) +
          ctaButton('Reset password', link) +
          paragraph('This code and link expire in one hour and can only be used once.', { muted: true, size: 14 }),
        footerNote: IGNORE_NOTE,
      })
      return { subject, html, text: textVersion('Reset your password', code, link) }
    }

    case 'invite': {
      const subject = `You’re invited to Get Lucky — code ${code}`
      const html = emailShell({
        title: subject,
        preheader: `Your invite code is ${code}.`,
        body:
          headline('You’re in.<br/>Swing your shot.') +
          paragraph('You’ve been invited to the Get Lucky Hole-in-1 Challenge. Use this code on the sign-in screen, or accept with the button.') +
          codeBlock(code) +
          ctaButton('Accept invite', link) +
          paragraph('The invite expires in one hour.', { muted: true, size: 14 }),
        footerNote: IGNORE_NOTE,
      })
      return { subject, html, text: textVersion('Accept your invite', code, link) }
    }

    case 'email_change': {
      const target = input.newEmail ? ` to <strong>${escapeHtml(input.newEmail)}</strong>` : ''
      const subject = `Confirm your new Get Lucky email — code ${code}`
      const html = emailShell({
        title: subject,
        preheader: `Your confirmation code is ${code}.`,
        body:
          headline('Confirm your<br/>new email') +
          paragraph(`You asked to change the email on your Get Lucky account${target}. Confirm with this code or the button.`) +
          codeBlock(code) +
          ctaButton('Confirm change', link) +
          (input.tokenNew && input.tokenHashNew
            ? divider() +
              paragraph('Because both addresses must agree, there is a second code for the new address:', { muted: true, size: 14 }) +
              codeBlock(input.tokenNew)
            : '') +
          paragraph('If you did not request this change, secure your account by signing in and updating your details.', { muted: true, size: 14 }),
        footerNote: IGNORE_NOTE,
      })
      return { subject, html, text: textVersion('Confirm your new email', code, link) }
    }

    case 'reauthentication': {
      const subject = `Your Get Lucky verification code: ${code}`
      const html = emailShell({
        title: subject,
        preheader: `Your verification code is ${code}.`,
        body:
          headline('Quick check.') +
          paragraph('Enter this code to confirm it’s really you.') +
          codeBlock(code) +
          paragraph('It expires in a few minutes and only works once.', { muted: true, size: 14 }),
        footerNote: IGNORE_NOTE,
      })
      return { subject, html, text: `Your Get Lucky verification code is ${code}. It expires in a few minutes.\n\n${IGNORE_NOTE}` }
    }

    // magiclink, signup, email
    default: {
      const subject = `Your Get Lucky sign-in code: ${code}`
      const html = emailShell({
        title: subject,
        preheader: `${code} is your sign-in code. Or tap the button.`,
        body:
          headline('Ready to<br/>get lucky?') +
          paragraph('Here’s your one-time sign-in code. Type it into the sign-in screen you have open:') +
          codeBlock(code) +
          paragraph('Or, if you’re reading this on the phone you play from, tap the button and you’re in.') +
          ctaButton('Sign in', link) +
          paragraph('The code and the button both expire in one hour and work once.', { muted: true, size: 14 }),
        footerNote: IGNORE_NOTE,
      })
      return { subject, html, text: textVersion('Sign in to Get Lucky', code, link) }
    }
  }
}

function textVersion(action: string, code: string, link: string): string {
  return [
    `${action}`,
    '',
    `Your one-time code: ${code}`,
    '',
    `Or open this link on the device you play from:`,
    link,
    '',
    'The code and link expire in one hour and can only be used once.',
    '',
    IGNORE_NOTE,
    '',
    'Get Lucky Golf · Proudly sponsored by Indwe Risk Services (FSP 3425).',
  ].join('\n')
}
