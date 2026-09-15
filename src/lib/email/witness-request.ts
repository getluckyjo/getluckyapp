/**
 * The one-question email a named witness or club official receives.
 * They have no account; the link carries a one-time token.
 */
import { emailShell, headline, paragraph, ctaButton, divider, escapeHtml, siteUrl } from '@/lib/email/layout'
import type { WitnessRole } from '@/types/database'

export interface WitnessRequestInput {
  role: WitnessRole
  witnessName: string
  golferName: string
  courseName: string
  holeNumber: number
  playedOn: string
  token: string
}

export function witnessLink(token: string): string {
  return `${siteUrl()}/witness/${token}`
}

export function buildWitnessRequest(input: WitnessRequestInput): { subject: string; html: string; text: string } {
  const first = input.witnessName.trim().split(' ')[0] || 'there'
  const link = witnessLink(input.token)
  const where = `${input.courseName}, hole ${input.holeNumber}, on ${input.playedOn}`
  const isClub = input.role === 'club_official'

  const question = isClub
    ? `${input.golferName} has claimed a hole-in-one at ${where} and named you as the club official who signed the certificate. Did your club issue that certificate?`
    : `${input.golferName} has claimed a hole-in-one at ${where} and says you were there. Did you see the ball go in?`

  const subject = isClub
    ? `Did your club certify ${input.golferName}'s hole-in-one?`
    : `Did you see ${input.golferName}'s hole-in-one?`

  const html = emailShell({
    title: subject,
    preheader: 'One question, one tap. It takes ten seconds.',
    body:
      headline(isClub ? 'A certificate<br/>to confirm' : 'Did you<br/>see it?') +
      paragraph(`Hi ${escapeHtml(first)},`) +
      paragraph(escapeHtml(question)) +
      paragraph('One tap answers it. Your answer goes to the review team and the insurer; it is not shown to the golfer.') +
      ctaButton('Answer', link) +
      divider() +
      paragraph(`If the link does not open, copy this into your browser:<br/><span style="word-break:break-all;">${escapeHtml(link)}</span>`, { size: 13, muted: true }) +
      paragraph('The link works once and expires in 14 days.', { size: 13, muted: true }),
    footerNote: `You are receiving this because ${escapeHtml(input.golferName)} named you on a hole-in-one claim at Get Lucky Golf. We keep your name and email only for this claim. Questions: support@getluckygolf.co.za`,
  })

  const text = [
    `Hi ${first},`,
    '',
    question,
    '',
    `Answer here (one tap, ten seconds): ${link}`,
    '',
    'Your answer goes to the review team and the insurer; it is not shown to the golfer.',
    'The link works once and expires in 14 days.',
    '',
    `You are receiving this because ${input.golferName} named you on a hole-in-one claim at Get Lucky Golf. Questions: support@getluckygolf.co.za`,
  ].join('\n')

  return { subject, html, text }
}
