/**
 * Putting Get Lucky on the home screen, for any screen that wants to offer it.
 *
 * Android Chrome fires `beforeinstallprompt` once per page load, when it
 * judges the site installable. The event is kept here, at module level,
 * from the moment the app boots (PwaChrome imports this file), so a screen
 * mounted later can still use it. `prompt()` must follow a tap: Chrome
 * refuses it otherwise, and promptInstall() answers 'unavailable'.
 *
 * iPhone has no such API. Only Safari can add a site to the home screen,
 * by hand (Share → Add to Home Screen), so screens show those taps instead.
 */

/** The Chrome event that lets a page open the install dialog itself. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type Platform = 'ios-safari' | 'ios-other' | 'android' | 'desktop'

/**
 * Which install route this browser has. iPhone browsers other than Safari
 * (Chrome, WhatsApp, Instagram, Gmail's in-app browser) cannot add to the
 * home screen; iPadOS reports itself as a Mac with a touch screen.
 */
export function detectPlatform(ua: string, platform = '', maxTouchPoints = 0): Platform {
  const iOS = /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)
  if (iOS) {
    const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram|Line\/|Twitter|WhatsApp/.test(ua)
    return safari ? 'ios-safari' : 'ios-other'
  }
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

export interface InstallState {
  /** Chrome handed us its install dialog, so one tap can open it. */
  canPrompt: boolean
  /** Installed during this page's life (Chrome's appinstalled). */
  installed: boolean
}

let deferred: BeforeInstallPromptEvent | null = null
let state: InstallState = { canPrompt: false, installed: false }
const listeners = new Set<() => void>()

function set(next: InstallState) {
  state = next
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    set({ ...state, canPrompt: true })
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    set({ canPrompt: false, installed: true })
  })
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function installState(): InstallState {
  return state
}

/** The server knows nothing of the browser: nothing to offer. */
export const SERVER_INSTALL_STATE: InstallState = { canPrompt: false, installed: false }

/**
 * Open Chrome's install dialog. Call it from a tap (or straight after one:
 * Chrome allows a few seconds). 'unavailable' when there is no dialog to
 * open or Chrome refused it, so the caller can show the manual steps.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred
  if (!event) return 'unavailable'
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    // The event is spent either way; Chrome sends a fresh one if it will ask again.
    deferred = null
    set({ canPrompt: false, installed: state.installed || outcome === 'accepted' })
    return outcome
  } catch {
    return 'unavailable'
  }
}
