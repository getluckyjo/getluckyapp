import { resend } from '@/lib/resend'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { emailShell, headline, paragraph, ctaButton, divider, escapeHtml, siteUrl } from '@/lib/email/layout'

const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS ?? 'Get Lucky Golf <noreply@getluckygolf.co.za>'

export async function POST(request: NextRequest) {
  try {
    const { email, name } = await request.json()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const firstName = typeof name === 'string' && name.trim() ? name.trim().split(' ')[0] : 'Golfer'

    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: email,
      subject: 'Welcome to Get Lucky. One shot, R1 million.',
      html: buildWelcomeHtml(firstName),
      text: buildWelcomeText(firstName),
    })

    if (error) {
      console.error('[welcome-email] Resend error:', error)
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    console.log('[welcome-email] Sent to', email, '— id:', data?.id)
    return NextResponse.json({ success: true, id: data?.id })
  } catch (err) {
    console.error('[welcome-email] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const TIERS = [
  ['R50', 'R25 000'],
  ['R100', 'R60 000'],
  ['R150', 'R100 000'],
  ['R250', 'R200 000'],
  ['R500', 'R500 000'],
  ['R1 000', 'R1 000 000'],
] as const

function buildWelcomeHtml(firstName: string): string {
  const site = siteUrl()
  const tierRows = TIERS.map(([stake, win]) =>
    `<tr>
      <td style="padding:7px 0;border-bottom:1px solid #ebedea;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;color:#345231;">Stake <strong>${stake}</strong></td>
      <td align="right" style="padding:7px 0;border-bottom:1px solid #ebedea;font-family:'Arial Black',Impact,Arial,sans-serif;font-size:15px;color:#345231;">WIN ${win}</td>
    </tr>`).join('')

  return emailShell({
    title: 'Welcome to Get Lucky',
    preheader: `${firstName}, you're in. Choose a par 3, bet on yourself, win up to R1 million.`,
    body:
      headline(`Welcome,<br/>${escapeHtml(firstName)}.`) +
      paragraph('You’re in. Next time you stand on a par-3 tee, your swing could be worth up to <strong>R1 000 000</strong>.') +
      paragraph('Choose a course. Pick your stake. Film the shot. Sink it and Indwe pays.') +
      ctaButton('Play now', `${site}/select-course`) +
      divider() +
      paragraph('<strong>Entry tiers</strong>', { size: 14 }) +
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 0 24px;">${tierRows}</table>`,
    footerNote: 'You’re receiving this because you signed up to Get Lucky Golf.',
  })
}

function buildWelcomeText(firstName: string): string {
  return [
    `Welcome, ${firstName}.`,
    '',
    'You’re in. Next time you stand on a par-3 tee, your swing could be worth up to R1 000 000.',
    'Choose a course. Pick your stake. Film the shot. Sink it and Indwe pays.',
    '',
    `Play now: ${siteUrl()}/select-course`,
    '',
    'Entry tiers:',
    ...TIERS.map(([stake, win]) => `  ${stake} → win ${win}`),
    '',
    'Get Lucky Golf · Proudly sponsored by Indwe Risk Services (FSP 3425).',
  ].join('\n')
}
