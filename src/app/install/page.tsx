import type { Metadata } from 'next'
import InstallScreen from '@/components/pwa/InstallScreen'

export const metadata: Metadata = {
  title: 'Get the Get Lucky app',
  description: 'Put Get Lucky on your phone in three taps. No app store needed.',
}

/** /install — the one link to send anyone who wants the app on their phone. */
export default function InstallPage() {
  return <InstallScreen />
}
