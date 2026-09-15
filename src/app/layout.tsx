import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AuthProvider } from '@/context/AuthContext'
import PwaChrome from '@/components/pwa/PwaChrome'
import FontLoader from '@/components/pwa/FontLoader'
import splash from '@/lib/pwa/splash.json'

const GOOGLE_FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap'

export const metadata: Metadata = {
  title: 'Get Lucky Golf — The Hole-in-One Challenge',
  description: 'Stake R50–R1,000 to win up to R1,000,000. Record your hole-in-one on any par-3 and claim your prize.',
  keywords: ['golf', 'hole-in-one', 'prize', 'South Africa', 'ZAR', 'competition'],
  applicationName: 'Get Lucky',
  openGraph: {
    title: 'Get Lucky Golf',
    description: 'One shot. R1,000,000. Back yourself on any par-3.',
    type: 'website',
    locale: 'en_ZA',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Get Lucky Golf',
    description: 'One shot. R1,000,000. Back yourself on any par-3.',
  },
  // iOS home-screen behaviour. black-translucent lets the screen run under
  // the status bar so the deep green header reads edge to edge; the header
  // pads itself with env(safe-area-inset-top) so nothing sits under the clock.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Get Lucky',
  },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  // Lets the page extend under the notch and home indicator on iOS so the
  // env(safe-area-inset-*) paddings on the header and tab bar take effect.
  viewportFit: 'cover',
  themeColor: '#345231',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en-ZA">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* The display face is on every screen's first paint; fetch it before the CSS asks. */}
        <link rel="preload" href="/fonts/PosterGothicRoundATF-Heavy.otf" as="font" type="font/otf" crossOrigin="anonymous" />
        {/* Body fonts from Google, loaded by <FontLoader/> after hydration so
            the stylesheet never blocks first paint (display=swap covers the
            gap); the noscript copy keeps it for browsers without JS. */}
        <noscript>
          <link href={GOOGLE_FONTS} rel="stylesheet" />
        </noscript>
        {/* iOS launch screens, one per device size. Generated: npm run pwa:assets. */}
        {splash.map(s => (
          <link key={s.href} rel="apple-touch-startup-image" href={s.href} media={s.media} />
        ))}
      </head>
      <body>
        <AuthProvider>
          {children}
          <PwaChrome />
          <FontLoader href={GOOGLE_FONTS} />
        </AuthProvider>
      </body>
    </html>
  )
}
