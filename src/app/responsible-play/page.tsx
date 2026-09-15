import LegalPage from '@/components/layout/LegalPage'

export default function ResponsiblePlayPage() {
  return (
    <LegalPage title={'Responsible\nplay'}>
      <p>
        Get Lucky Golf is a skill-based challenge, not a game of chance. However, we encourage all users to play responsibly.
      </p>

      <h2>Our commitment</h2>
      <ul>
        <li>Only users aged 18+ may participate</li>
        <li>All stakes and potential winnings are shown clearly before payment</li>
        <li>There are no hidden fees or recurring charges</li>
        <li>Each entry is a one-time payment for a single attempt</li>
      </ul>

      <h2>Tips for players</h2>
      <ul>
        <li>Set a personal budget for entries and stick to it</li>
        <li>Play for fun — a hole-in-one is a rare achievement</li>
        <li>Never stake more than you can comfortably afford to lose</li>
      </ul>

      <h2>Need help?</h2>
      <p>
        If you feel your participation is becoming problematic, contact us at support@getluckygolf.co.za and we can help restrict or close your account.
      </p>
    </LegalPage>
  )
}
