'use client'

import Image from 'next/image'

/**
 * Indwe sponsor lockup. V2 shows it as the landing page footer
 * ("Proudly sponsored by Indwe Risk Services") rather than stacked inside
 * the tab bar on every screen.
 */
export default function SponsorBanner({ className }: { className?: string }) {
  return (
    <div className={`sponsor-band${className ? ` ${className}` : ''}`}>
      <Image
        src="/GLG_Indwe_FSP_Banner.png"
        alt="Proudly sponsored by Indwe Risk Services — an Authorised Financial Services Provider, FSP 3425"
        width={800}
        height={167}
        priority
        style={{ width: '100%', maxWidth: 320, height: 'auto' }}
      />
    </div>
  )
}
