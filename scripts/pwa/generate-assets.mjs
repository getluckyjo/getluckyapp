#!/usr/bin/env node
/**
 * PWA asset generator (build-time, regenerable).
 *
 * Generates every raster asset the PWA manifest and iOS home-screen install
 * need, from one committed source:
 *   - public/brand/logo-corner.svg (the designer's "Get Lucky" script)
 *
 * The app icon itself is composed here first (option A, chosen 16 Sep 2026):
 * a flat lime square with the script in brand green, the cream outline
 * dropped so the mark sits directly on the lime.
 *   public/apple-icon.png                     1024x1024 composed app icon
 *
 * Outputs:
 *   public/icons/icon-{192,256,384,512}.png   manifest icons, purpose "any"
 *   public/icons/icon-maskable-512.png        purpose "maskable" (lockup kept
 *                                             inside the inner 80% safe zone)
 *   public/icons/apple-touch-icon-180.png     iOS home-screen icon
 *   public/icons/favicon-{32,16}.png
 *   src/app/favicon.ico                       16/32/48 for browser tabs
 *   public/splash/splash-<w>x<h>.png          iOS portrait startup images
 *   src/lib/pwa/splash.json                   href + media query per splash,
 *                                             imported by the app layout to
 *                                             render <link rel="apple-touch-startup-image">
 *
 * Re-run with:  npm run pwa:assets   (or: node scripts/pwa/generate-assets.mjs)
 * The script is deterministic and idempotent: it overwrites all outputs and
 * needs only `sharp` (already a devDependency).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_MARK = path.join(ROOT, "public/brand/logo-corner.svg");
const SRC_ICON = path.join(ROOT, "public/apple-icon.png");
const FAVICON_ICO = path.join(ROOT, "src/app/favicon.ico");
const ICONS_DIR = path.join(ROOT, "public/icons");
const SPLASH_DIR = path.join(ROOT, "public/splash");
const SPLASH_JSON = path.join(ROOT, "src/lib/pwa/splash.json");

const CREAM = "#f5eede";
const GREEN = "#345231";
const LIME = "#d6fb4b";
const ICON_BG = LIME;
const ICON_SIZE = 1024;
const ICON_MARK_SCALE = 0.78; // the script's width as a fraction of the square

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

/**
 * The app icon: brand green script on a flat lime square. The corner
 * logo's cream and white outline paths are recoloured to the background so
 * only the green script shows.
 */
async function generateSourceIcon() {
  const svg = (await readFile(SRC_MARK, "utf8")).replaceAll("#fff", ICON_BG).replaceAll(CREAM, ICON_BG);
  const inner = Math.round(ICON_SIZE * ICON_MARK_SCALE);
  const mark = await sharp(Buffer.from(svg), { density: 600 })
    .resize({ width: inner, height: inner, fit: "inside" })
    .png()
    .toBuffer();
  const m = await sharp(mark).metadata();
  await writePng(
    sharp({ create: { width: ICON_SIZE, height: ICON_SIZE, channels: 3, background: ICON_BG } }).composite([
      { input: mark, left: Math.round((ICON_SIZE - m.width) / 2), top: Math.round((ICON_SIZE - m.height) / 2) },
    ]),
    SRC_ICON,
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

  // Maskable: solid lime canvas with the icon scaled down so the script sits
  // within the inner 80% circle that launchers may crop to.
  const inner = Math.round(MASKABLE_SIZE * MASKABLE_CONTENT_SCALE);
  const content = await sharp(SRC_ICON).resize(inner, inner, { kernel: "lanczos3" }).toBuffer();
  await writePng(
    sharp({
      create: { width: MASKABLE_SIZE, height: MASKABLE_SIZE, channels: 3, background: ICON_BG },
    }).composite([{ input: content, gravity: "centre" }]),
    path.join(ICONS_DIR, `icon-maskable-${MASKABLE_SIZE}.png`),
  );

  await writePng(
    sharp(SRC_ICON).resize(180, 180, { kernel: "lanczos3" }).flatten({ background: ICON_BG }),
    path.join(ICONS_DIR, "apple-touch-icon-180.png"),
  );

  for (const size of [32, 16]) {
    await writePng(
      sharp(SRC_ICON).resize(size, size, { kernel: "lanczos3" }),
      path.join(ICONS_DIR, `favicon-${size}.png`),
    );
  }

  // Browser-tab favicon: one .ico carrying 16, 32 and 48.
  const frames = await Promise.all([16, 32, 48].map(size => sharp(SRC_ICON).resize(size, size, { kernel: "lanczos3" }).png().toBuffer()));
  const ico = await pngToIco(frames);
  await writeFile(FAVICON_ICO, ico);
  written.push({ file: path.relative(ROOT, FAVICON_ICO), bytes: ico.length });
}

async function generateSplash() {
  await mkdir(SPLASH_DIR, { recursive: true });
  await mkdir(path.dirname(SPLASH_JSON), { recursive: true });

  const entries = [];
  for (const { width, height, ratio } of SPLASH_SIZES) {
    const tile = Math.round(Math.min(width, height) * SPLASH_TILE_FRACTION);
    const radius = Math.round(tile * SPLASH_TILE_RADIUS);

    // Icon already carries the lime background; resize and clip its corners.
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
await generateSourceIcon();
await generateIcons();
await generateSplash();

const total = written.reduce((sum, w) => sum + w.bytes, 0);
for (const w of written) {
  console.log(`${w.file.padEnd(44)} ${(w.bytes / 1024).toFixed(1).padStart(7)} KB`);
}
console.log(`\n${written.length} files, ${(total / 1024).toFixed(1)} KB total, ${Date.now() - started} ms`);
