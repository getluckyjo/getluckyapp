#!/usr/bin/env node
/**
 * PWA asset generator (build-time, regenerable).
 *
 * Generates every raster asset the PWA manifest and iOS home-screen install
 * need, from two committed sources:
 *   - public/apple-icon.png        (1024x1024 composed app icon, cream bg)
 *   - public/brand/logo-lockup.png (lockup only, RGBA; reserved for future use)
 *
 * Outputs:
 *   public/icons/icon-{192,256,384,512}.png   manifest icons, purpose "any"
 *   public/icons/icon-maskable-512.png        purpose "maskable" (lockup kept
 *                                             inside the inner 80% safe zone)
 *   public/icons/apple-touch-icon-180.png     iOS home-screen icon
 *   public/icons/favicon-{32,16}.png
 *   public/splash/splash-<w>x<h>.png          iOS portrait startup images
 *   src/lib/pwa/splash.json                   href + media query per splash,
 *                                             imported by the app layout to
 *                                             render <link rel="apple-touch-startup-image">
 *
 * Re-run with:  npm run pwa:assets   (or: node scripts/pwa/generate-assets.mjs)
 * The script is deterministic and idempotent: it overwrites all outputs and
 * needs only `sharp` (already a devDependency).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_ICON = path.join(ROOT, "public/apple-icon.png");
const ICONS_DIR = path.join(ROOT, "public/icons");
const SPLASH_DIR = path.join(ROOT, "public/splash");
const SPLASH_JSON = path.join(ROOT, "src/lib/pwa/splash.json");

const CREAM = "#f5eede";
const GREEN = "#345231";

// Palette PNGs: flat brand colours quantise cleanly and stay small.
const PNG_OPTS = { compressionLevel: 9, palette: true, effort: 10 };
// Splash screens are two flat colours plus anti-aliased edges; a slightly
// smaller palette roughly halves their size with no visible change.
const SPLASH_PNG_OPTS = { ...PNG_OPTS, quality: 90 };

/** iOS device sizes in device pixels (portrait), with pixel ratio. */
const SPLASH_SIZES = [
  { width: 1320, height: 2868, ratio: 3 },
  { width: 1206, height: 2622, ratio: 3 },
  { width: 1290, height: 2796, ratio: 3 },
  { width: 1179, height: 2556, ratio: 3 },
  { width: 1284, height: 2778, ratio: 3 },
  { width: 1170, height: 2532, ratio: 3 },
  { width: 1125, height: 2436, ratio: 3 },
  { width: 1242, height: 2688, ratio: 3 },
  { width: 828, height: 1792, ratio: 2 },
  { width: 1242, height: 2208, ratio: 3 },
  { width: 750, height: 1334, ratio: 2 },
  { width: 640, height: 1136, ratio: 2 },
];

const ICON_SIZES = [192, 256, 384, 512];
const MASKABLE_SIZE = 512;
const MASKABLE_CONTENT_SCALE = 0.72; // keeps the lockup inside the 80% safe circle
const SPLASH_TILE_FRACTION = 0.34; // tile side = 34% of the shorter screen edge
const SPLASH_TILE_RADIUS = 0.22; // corner radius as fraction of tile side

const written = [];

async function writePng(pipeline, file, opts = PNG_OPTS) {
  const buf = await pipeline.png(opts).toBuffer();
  await writeFile(file, buf);
  written.push({ file: path.relative(ROOT, file), bytes: buf.length });
}

function roundedMask(size, radius) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  );
}

async function generateIcons() {
  await mkdir(ICONS_DIR, { recursive: true });

  for (const size of ICON_SIZES) {
    await writePng(
      sharp(SRC_ICON).resize(size, size, { kernel: "lanczos3" }),
      path.join(ICONS_DIR, `icon-${size}.png`),
    );
  }

  // Maskable: solid cream canvas with the icon scaled down so the lockup sits
  // within the inner 80% circle that launchers may crop to.
  const inner = Math.round(MASKABLE_SIZE * MASKABLE_CONTENT_SCALE);
  const content = await sharp(SRC_ICON).resize(inner, inner, { kernel: "lanczos3" }).toBuffer();
  await writePng(
    sharp({
      create: { width: MASKABLE_SIZE, height: MASKABLE_SIZE, channels: 3, background: CREAM },
    }).composite([{ input: content, gravity: "centre" }]),
    path.join(ICONS_DIR, `icon-maskable-${MASKABLE_SIZE}.png`),
  );

  await writePng(
    sharp(SRC_ICON).resize(180, 180, { kernel: "lanczos3" }).flatten({ background: CREAM }),
    path.join(ICONS_DIR, "apple-touch-icon-180.png"),
  );

  for (const size of [32, 16]) {
    await writePng(
      sharp(SRC_ICON).resize(size, size, { kernel: "lanczos3" }),
      path.join(ICONS_DIR, `favicon-${size}.png`),
    );
  }
}

async function generateSplash() {
  await mkdir(SPLASH_DIR, { recursive: true });
  await mkdir(path.dirname(SPLASH_JSON), { recursive: true });

  const entries = [];
  for (const { width, height, ratio } of SPLASH_SIZES) {
    const tile = Math.round(Math.min(width, height) * SPLASH_TILE_FRACTION);
    const radius = Math.round(tile * SPLASH_TILE_RADIUS);

    // Icon already carries the cream background; resize and clip its corners.
    const tileBuf = await sharp(SRC_ICON)
      .resize(tile, tile, { kernel: "lanczos3" })
      .ensureAlpha()
      .composite([{ input: roundedMask(tile, radius), blend: "dest-in" }])
      .png()
      .toBuffer();

    const name = `splash-${width}x${height}.png`;
    await writePng(
      sharp({ create: { width, height, channels: 3, background: GREEN } }).composite([
        { input: tileBuf, gravity: "centre" },
      ]),
      path.join(SPLASH_DIR, name),
      SPLASH_PNG_OPTS,
    );

    const cssW = Math.round(width / ratio);
    const cssH = Math.round(height / ratio);
    entries.push({
      href: `/splash/${name}`,
      media: `(device-width: ${cssW}px) and (device-height: ${cssH}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`,
    });
  }

  const json = `${JSON.stringify(entries, null, 2)}\n`;
  await writeFile(SPLASH_JSON, json);
  written.push({ file: path.relative(ROOT, SPLASH_JSON), bytes: Buffer.byteLength(json) });
}

const started = Date.now();
await generateIcons();
await generateSplash();

const total = written.reduce((sum, w) => sum + w.bytes, 0);
for (const w of written) {
  console.log(`${w.file.padEnd(44)} ${(w.bytes / 1024).toFixed(1).padStart(7)} KB`);
}
console.log(`\n${written.length} files, ${(total / 1024).toFixed(1)} KB total, ${Date.now() - started} ms`);
