import type { UploadState } from './types'

export interface UploadChip {
  tone: 'busy' | 'ok' | 'error' | 'wait'
  label: string
  spinner: boolean
  /** Tapping it asks the manager to try again. */
  retry: boolean
}

/** What a screen says about the shot's upload, from the manager's state. Pure. */
export function uploadChip(state: UploadState | undefined, now: number = Date.now()): UploadChip {
  if (!state) return { tone: 'busy', label: 'Saving video', spinner: true, retry: false }
  switch (state.status) {
    case 'done': return { tone: 'ok', label: 'Video saved', spinner: false, retry: false }
    case 'uploading': return { tone: 'busy', label: `Saving video · ${state.progress}%`, spinner: true, retry: false }
    case 'queued':
    case 'preparing':
    case 'sealing': return { tone: 'busy', label: 'Saving video', spinner: true, retry: false }
    case 'waiting': {
      if (state.waitingOn === 'online') return { tone: 'wait', label: 'Waiting for signal. Tap to retry', spinner: false, retry: true }
      if (state.waitingOn === 'auth') return { tone: 'wait', label: 'Sign in to finish saving. Tap to retry', spinner: false, retry: true }
      const secs = state.nextRetryAt ? Math.max(1, Math.ceil((state.nextRetryAt - now) / 1000)) : null
      return { tone: 'wait', label: secs ? `Retrying in ${secs}s. Tap to retry now` : 'Retrying. Tap to retry now', spinner: false, retry: true }
    }
    case 'blocked': {
      const why =
        state.blocked === 'too_large' ? 'the clip is too large' :
        state.blocked === 'expired' ? 'the upload window has closed' :
        state.blocked === 'not_yours' ? 'this bet is not on this account' :
        state.blocked === 'unsupported_type' ? 'this video format is not supported' :
        state.blocked === 'resolved' ? 'this bet is closed' :
        'it could not be saved'
      return { tone: 'error', label: `Video not saved: ${why}. Tap to retry`, spinner: false, retry: true }
    }
  }
}
