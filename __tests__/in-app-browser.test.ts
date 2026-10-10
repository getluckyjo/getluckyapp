/**
 * src/lib/in-app-browser.ts — telling an app's embedded web view from a
 * real browser, so the Google tile is not offered where Google refuses it.
 */
import { describe, it, expect } from 'vitest'
import { isInAppBrowser } from '@/lib/in-app-browser'

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  iphoneWhatsApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/25.20.79',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85',
  iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/520.0.0.38.101;FBBV/...;FBDV/iPhone15,2]',
  androidInstagram: 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36 Instagram 390.0.0.28.85 Android',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36',
  androidTikTok: 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36 trill_2023 BytedanceWebview/d8a21c6',
  iphoneGmail: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSA/354.0.0 Safari/604.1',
}

describe('isInAppBrowser', () => {
  it('a real browser is not one', () => {
    for (const ua of [UA.iphoneSafari, UA.iphoneChrome, UA.androidChrome]) expect(isInAppBrowser(ua), ua).toBe(false)
    expect(isInAppBrowser('')).toBe(false)
    expect(isInAppBrowser(undefined)).toBe(false)
  })

  it('the apps the Icons Cup traffic comes from are', () => {
    for (const ua of [UA.iphoneWhatsApp, UA.iphoneInstagram, UA.iphoneFacebook, UA.androidInstagram, UA.androidWebView, UA.androidTikTok, UA.iphoneGmail]) {
      expect(isInAppBrowser(ua), ua).toBe(true)
    }
  })
})
