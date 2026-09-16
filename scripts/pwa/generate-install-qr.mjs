#!/usr/bin/env node
/**
 * The QR code on /install and on printed material: it opens the install
 * page. Writes public/marketing/install-qr.svg and a 1024 px PNG for print.
 * Re-run with: npm run install:qr
 */
import { writeFileSync } from 'node:fs'
import QRCode from 'qrcode'
import sharp from 'sharp'

const URL_ = 'https://www.getluckyholeinone.com/install'
const svg = await QRCode.toString(URL_, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#345231', light: '#ffffff' } })
writeFileSync('public/marketing/install-qr.svg', svg)
await sharp(Buffer.from(svg)).resize({ width: 1024 }).png().toFile('public/marketing/install-qr.png')
console.log('wrote public/marketing/install-qr.svg and install-qr.png for', URL_)
