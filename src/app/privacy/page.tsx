import LegalPage from '@/components/layout/LegalPage'

/**
 * The privacy policy describes what the app actually does (docs/batch-8-popia.md).
 * When the code changes what is collected, kept or shared, this page changes
 * with it. It is not legal advice; the wording has not been reviewed by a lawyer.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title={'Privacy\npolicy'} effective="September 2026">
      <p>
        Get Lucky Golf processes your personal information under the Protection of Personal Information Act (POPIA). This page says what we collect, why, who sees it, how long we keep it, and how to have it corrected or deleted.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account:</strong> your email address and, if you sign in with Google, the name on your Google profile.</li>
        <li><strong>Age check:</strong> your date of birth and when you confirmed you are 18 or over, and when you accepted the terms.</li>
        <li><strong>Profile:</strong> your name and handicap, if you add them.</li>
        <li><strong>Play:</strong> the course, hole, stake, result and time of every challenge you enter, and PayFast&apos;s reference for each payment. Card details go to PayFast and never reach us.</li>
        <li><strong>Footage:</strong> the video of your shot, with the time it was uploaded and a fingerprint of the file so it cannot be swapped later.</li>
        <li><strong>Claim documents:</strong> the scorecard or certificate and the witness affidavit you upload for a hole-in-one claim. These contain other people&apos;s names and signatures; by uploading them you confirm those people know and agree.</li>
        <li><strong>Technical:</strong> your IP address and device details in server logs and error reports, kept for a short time to keep the service running and to stop abuse.</li>
      </ul>

      <h2>Why</h2>
      <p>To run the challenge you entered, take your payment, verify a claim, pay a prize, keep the records an insured prize requires, prevent fraud, and tell you about your own account. We do not sell your information or use it for advertising.</p>

      <h2>Who sees it</h2>
      <ul>
        <li><strong>Our team</strong>, when reviewing a claim or helping you with your account.</li>
        <li><strong>Indwe Risk Services (FSP 3425)</strong>, the insurer, receives the footage, documents and details of a claim they are asked to pay.</li>
        <li><strong>PayFast</strong> processes payments and sends us confirmation of each one.</li>
        <li><strong>Suppliers who host the service for us:</strong> Supabase (database, sign-in and file storage), Vercel (hosting), Resend (email), Sentry (error monitoring) and Google (sign-in, if you use it). They process data on our instructions.</li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li><strong>Footage of a miss</strong> is deleted 90 days after you declared the result.</li>
        <li><strong>Documents and footage of a rejected claim</strong> are deleted 90 days after the review.</li>
        <li><strong>Footage, documents and records of an approved or paid claim</strong> are kept for as long as the insurer and the law require.</li>
        <li><strong>Payment records</strong> are kept for the period financial regulation requires, without your name once your account is deleted.</li>
        <li><strong>Your account</strong> is kept until you delete it.</li>
      </ul>

      <h2>Deleting your account</h2>
      <p>Open <strong>My account</strong> and choose <strong>Delete account</strong>. This removes your profile, your challenges, your footage and your documents. Unplayed challenges are forfeited and stakes are not refunded. Payment records stay, without your name, and so does the log of claim decisions.</p>
      <p>If you have a claim under review or a paid prize on record, or your account is suspended, those records must be kept and the account is closed by support instead. Membership of the Get Lucky Golf Club is managed separately and is not cancelled by deleting your app account.</p>

      <h2>Your rights</h2>
      <p>You may ask what we hold about you, have it corrected, or object to how it is used, by writing to <a href="mailto:support@getluckygolf.co.za">support@getluckygolf.co.za</a>. You may also complain to the Information Regulator of South Africa.</p>
    </LegalPage>
  )
}
