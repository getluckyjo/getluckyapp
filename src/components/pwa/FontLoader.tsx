'use client'

import { useEffect } from 'react'

/**
 * Adds the Google Fonts stylesheet after hydration. A <link rel="stylesheet">
 * in the head blocks first paint until Google answers, which on a course with
 * one bar of signal is the difference between a screen and a blank one. The
 * fonts use display=swap, so text shows in the system face until they land.
 */
export default function FontLoader({ href }: { href: string }) {
  useEffect(() => {
    if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
  }, [href])
  return null
}
