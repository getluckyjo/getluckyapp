import type { CaptureInput } from '@/lib/claims/capture'

export type UploadStatus = 'queued' | 'preparing' | 'uploading' | 'sealing' | 'done' | 'waiting' | 'blocked'
export type WaitingOn = 'online' | 'backoff' | 'auth' | 'rate_limit' | null
export type BlockedReason = 'not_yours' | 'expired' | 'too_large' | 'unsupported_type' | 'no_footage' | 'resolved'

export interface UploadState {
  betId: string
  status: UploadStatus
  /** 0–100 of the bytes of the current attempt. */
  progress: number
  /** Attempts started so far. */
  attempt: number
  /** Epoch ms of the next retry while waiting on a backoff. */
  nextRetryAt: number | null
  waitingOn: WaitingOn
  blocked?: BlockedReason
  /** The last failure, for the logs and the chip's small print. */
  lastError?: string
}

/** What a transport must do; the manager owns retries, order and persistence. */
export interface UploadTransport {
  /** Ask the server to seal what has landed. */
  seal(betId: string): Promise<SealOutcome>
  /** Ask for a slot. */
  prepare(betId: string, mimeType: string, capture: CaptureInput | null): Promise<PrepareOutcome>
  /** Send the bytes. Rejects with a TransportError. */
  put(signedUrl: string, blob: Blob, mimeType: string, onProgress: (pct: number) => void, signal: AbortSignal): Promise<void>
}

export type SealOutcome = { kind: 'sealed' } | { kind: 'missing' }
export type PrepareOutcome = { kind: 'slot'; signedUrl: string; storagePath: string } | { kind: 'sealed' }

/** How an attempt failed, decided by the transport, acted on by the manager. */
export class TransportError extends Error {
  constructor(
    public reason: 'offline' | 'network' | 'timeout' | 'stalled' | 'rate_limited' | 'unauthorized' | 'blocked' | 'server',
    message: string,
    public blocked?: BlockedReason,
    public retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'TransportError'
  }
}
