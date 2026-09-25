/**
 * src/lib/pwa/install.ts — putting Get Lucky on the home screen.
 *
 * Pinned here: which install route each phone and browser gets, and that
 * Chrome's install dialog is kept from boot, opened once, and reported
 * honestly ('unavailable' when there is nothing to open or Chrome refuses).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { detectPlatform } from '@/lib/pwa/install'

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  iphoneWhatsApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/25.20.79',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
}

describe('detectPlatform', () => {
  it('only Safari on an iPhone can add to the home screen', () => {
    expect(detectPlatform(UA.iphoneSafari)).toBe('ios-safari')
    for (const ua of [UA.iphoneChrome, UA.iphoneWhatsApp, UA.iphoneInstagram]) expect(detectPlatform(ua)).toBe('ios-other')
  })

  it('an iPad passes as a Mac, and is told apart by its touch screen', () => {
    expect(detectPlatform(UA.ipad, 'MacIntel', 5)).toBe('ios-safari')
    expect(detectPlatform(UA.ipad, 'MacIntel', 0)).toBe('desktop')
  })

  it('Android is Android; a computer is a desktop', () => {
    expect(detectPlatform(UA.android)).toBe('android')
    expect(detectPlatform(UA.mac, 'MacIntel', 0)).toBe('desktop')
  })
})

describe('the install dialog', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  /** A fresh copy of the module, loaded into a stand-in browser window. */
  async function boot() {
    const win = new EventTarget()
    vi.stubGlobal('window', win)
    vi.resetModules()
    const mod = await import('@/lib/pwa/install')
    return { win, mod }
  }

  function chromeOffers(win: EventTarget, outcome: 'accepted' | 'dismissed', refuse = false) {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => { if (refuse) throw new DOMException('needs a user gesture', 'NotAllowedError') }),
      userChoice: Promise.resolve({ outcome }),
    })
    win.dispatchEvent(event)
    return event
  }

  it('there is nothing to open until Chrome offers it', async () => {
    const { mod } = await boot()
    expect(mod.installState()).toEqual({ canPrompt: false, installed: false })
    expect(await mod.promptInstall()).toBe('unavailable')
  })

  it('keeps Chrome\'s offer, stops its own banner, and tells listeners', async () => {
    const { win, mod } = await boot()
    const heard = vi.fn()
    mod.subscribeInstall(heard)
    const event = chromeOffers(win, 'accepted')
    expect(event.defaultPrevented).toBe(true)
    expect(heard).toHaveBeenCalled()
    expect(mod.installState().canPrompt).toBe(true)
  })

  it('opens the dialog once: accepted means installed, and the offer is spent', async () => {
    const { win, mod } = await boot()
    const event = chromeOffers(win, 'accepted')
    expect(await mod.promptInstall()).toBe('accepted')
    expect(event.prompt).toHaveBeenCalledOnce()
    expect(mod.installState()).toEqual({ canPrompt: false, installed: true })
    expect(await mod.promptInstall()).toBe('unavailable')
  })

  it('a dismissal is a dismissal, not an install', async () => {
    const { win, mod } = await boot()
    chromeOffers(win, 'dismissed')
    expect(await mod.promptInstall()).toBe('dismissed')
    expect(mod.installState()).toEqual({ canPrompt: false, installed: false })
  })

  it('Chrome refusing (no recent tap) reads as unavailable, so the steps are shown instead', async () => {
    const { win, mod } = await boot()
    chromeOffers(win, 'accepted', true)
    expect(await mod.promptInstall()).toBe('unavailable')
  })

  it('an install from Chrome\'s own menu is noticed too', async () => {
    const { win, mod } = await boot()
    chromeOffers(win, 'accepted')
    win.dispatchEvent(new Event('appinstalled'))
    expect(mod.installState()).toEqual({ canPrompt: false, installed: true })
  })
})
