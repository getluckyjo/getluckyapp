/**
 * Cache-busting for the generated PWA artwork (icons, favicons, splash
 * screens under public/icons and public/splash).
 *
 * The service worker caches those paths cache-first for a year and iOS
 * keeps its own copies, so a regenerated file behind the same URL is never
 * seen by a phone that already has the old one. Bump PWA_ASSET_VERSION
 * after `npm run pwa:assets` changes the artwork; every link goes through
 * pwaAsset() so the new query string reaches the manifest, the <head>
 * links and the install screens together.
 *
 *   v1  cream tile, "Hole-in 1 Challenge" badge
 *   v2  lime tile, green script (16 Sep 2026)
 */
export const PWA_ASSET_VERSION = '2'

export function pwaAsset(path: string): string {
  return `${path}?v=${PWA_ASSET_VERSION}`
}
