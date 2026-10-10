import LegalPage from '@/components/layout/LegalPage'

export default function TermsPage() {
  return (
    <LegalPage title={'Terms &\nconditions'} effective="March 2026">
      <p>
        Get Lucky Golf (&quot;the Platform&quot;) is a skill-based challenge platform where registered users stake on their ability to hit a hole-in-one on designated par-3 holes at participating golf courses across South Africa.
      </p>

      <h2>1. Eligibility</h2>
      <p>You must be 18 years or older to create an account. Paid entries (stakes) are open to residents of South Africa. Free swings, promo swings, sponsored golf-day swings and the Icons Cup fan pick are open to anyone aged 18 or older, unless the terms of that promotion say otherwise. By creating an account you confirm that you meet these requirements.</p>

      <h2>2. How it works</h2>
      <p>Select a participating course and par-3 hole. Choose a stake tier (R50–R1 000). Record your tee shot via the app. If your shot results in a verified hole-in-one, you win the corresponding prize (up to R1 000 000).</p>

      <h2>3. Verification</h2>
      <p>All claims require video evidence and supporting documentation (course scorecard, witness affidavit). Claims are reviewed within 5 business days. Get Lucky reserves the right to request additional evidence.</p>

      <h2>4. Prizes &amp; insurance</h2>
      <p>Prizes on paid entries, and the Icons Cup South Africa hole-in-one prize, are insured by Indwe Risk Services (FSP 3425), an authorised Financial Services Provider. Free swing, promo swing and sponsored golf-day prizes are paid by Get Lucky Golf. Verified prizes are paid within 14 business days of approval.</p>

      <h2>5. Icons Cup fan prize</h2>
      <p>On the Icons tab you may back one Icon. If the Icon you backed holes the Get Lucky hole at Icons Cup South Africa, you are in a draw for one of three R1 000 000 prizes. Picks close at the first tee of the event, or earlier when the backer list is frozen; the time is shown on the Icons tab. The frozen list is hashed (SHA-256) and the hash is published before the shot is played. Winners are drawn among the eligible backers of that Icon by ranking each backer with HMAC-SHA256 of a seed announced after the shot, lowest first; the seed, the list and the result are kept so that anyone can re-run the draw. Get Lucky Golf staff, suspended accounts and anyone under 18 are not eligible. The hole-in-one itself is confirmed by the event&apos;s live broadcast and the organisers&apos; official result, not through the app. If no Icon holes it, no fan prize is paid.</p>

      <h2>6. Payments</h2>
      <p>All payments are processed securely via PayFast. Stakes are non-refundable once a round has been recorded.</p>

      <h2>7. Contact</h2>
      <p>For queries, contact support@getluckygolf.co.za</p>
    </LegalPage>
  )
}
