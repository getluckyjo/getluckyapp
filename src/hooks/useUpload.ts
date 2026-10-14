'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { getUploadManager, type UploadState } from '@/lib/upload'

const IDLE: UploadState = { betId: '', status: 'queued', progress: 0, attempt: 0, nextRetryAt: null, waitingOn: null }

/** The upload manager's state for one bet, live; `undefined` when nothing is queued for it. */
export function useUpload(betId: string | null): { state: UploadState | undefined; retry: () => void } {
  const subscribe = useCallback((cb: () => void) => getUploadManager().subscribe(cb), [])
  const get = useCallback(() => (betId ? getUploadManager().get(betId) : undefined), [betId])
  const state = useSyncExternalStore(subscribe, get, () => undefined)
  const retry = useCallback(() => { if (betId) getUploadManager().kick(betId) }, [betId])
  return { state, retry }
}

export { IDLE as IDLE_UPLOAD }
