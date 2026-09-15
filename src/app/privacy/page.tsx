import LegalPage from '@/components/layout/LegalPage'

export default function PrivacyPage() {
  return (
    <LegalPage title={'Privacy\npolicy'} effective="March 2026">
      <p>
        Get Lucky Golf respects your privacy and is committed to protecting your personal information in accordance with the Protection of Personal Information Act (POPIA).
      </p>

      <h2>What we collect</h2>
      <p>We collect your name, email address, and payment information when you create an account and enter challenges. We also store video recordings of your shots for verification purposes.</p>

      <h2>How we use it</h2>
      <p>Your information is used solely to operate the platform, process payments via PayFast, verify claims, and communicate with you about your account.</p>

      <h2>Data security</h2>
      <p>We use industry-standard encryption and secure hosting. Payment data is handled exclusively by PayFast and never stored on our servers.</p>

      <h2>Your rights</h2>
      <p>You may request access to, correction of, or deletion of your personal information at any time by contacting support@getluckygolf.co.za</p>

      <h2>Third parties</h2>
      <p>We share data only with PayFast (payments), Indwe Risk Services (insurance), and Supabase (hosting). We never sell your data.</p>
    </LegalPage>
  )
}
