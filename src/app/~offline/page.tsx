import type { Metadata } from 'next'
import OfflineScreen from '@/components/pwa/OfflineScreen'

/**
 * The service worker's navigation fallback. Precached at build time and
 * shown in place of any page that cannot be fetched. It must not depend on
 * anything that needs the network: no session check, no data, no image
 * optimiser (the logo is an SVG under /brand, which the worker also caches).
 */
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'You are offline — Get Lucky Golf',
  robots: { index: false, follow: false },
}

export default function OfflinePage() {
  return <OfflineScreen />
}
