# PWA assets

`generate-assets.mjs` builds every raster asset the PWA needs from
`public/apple-icon.png` (1024x1024 composed icon): manifest icons
(`public/icons/icon-*.png`, plus a maskable 512 with the lockup kept inside the
80% safe zone), `apple-touch-icon-180.png`, `favicon-32/16.png`, and iOS
portrait startup images in `public/splash/` (deep green background, centred
cream rounded tile). It also writes `src/lib/pwa/splash.json`, the
`{ href, media }` list the layout uses for `<link rel="apple-touch-startup-image">`.

Re-run after changing the source icon: `npm run pwa:assets`.
Deterministic and idempotent; only dependency is `sharp` (devDependency).
