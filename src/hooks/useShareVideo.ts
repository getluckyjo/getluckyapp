'use client'

import { useState, useCallback, useMemo } from 'react'

interface ShareVideoOptions {
  videoBlob: Blob | null
  title: string
  text: string
  url?: string
}

export function useShareVideo(options: ShareVideoOptions) {
  const { videoBlob, title, text, url = typeof window !== 'undefined' ? window.location.origin : 'https://www.getluckyholeinone.com' } = options
  const [isSharing, setIsSharing] = useState(false)

  const hasVideo = Boolean(videoBlob && videoBlob.size > 0)

  const fileExtension = useMemo(() => {
    const type = videoBlob?.type ?? ''
    if (type.includes('mp4')) return 'mp4'
    return 'webm'
  }, [videoBlob?.type])

  const canShareFiles = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    if (!navigator.share || !navigator.canShare) return false
    if (!videoBlob) return false

    // iOS cannot share webm files — canShare() returns true but sharing
    // fails with "This item cannot be shared" at the OS level.
    // Only allow file sharing when the format is mp4 on iOS.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.userAgent.includes('Mac') && 'ontouchend' in document)
    const videoType = videoBlob.type || ''
    if (isIOS && !videoType.includes('mp4')) return false

    try {
      const testFile = new File([videoBlob], `shot.${fileExtension}`, {
        type: videoType || 'video/webm',
      })
      return navigator.canShare({ files: [testFile] })
    } catch {
      return false
    }
  }, [videoBlob, fileExtension])

  const canShareText = typeof navigator !== 'undefined' && Boolean(navigator.share)

  // Returns true if share succeeded, false if it failed (so caller can fall back)
  const shareWithVideo = useCallback(async (): Promise<boolean> => {
    if (!videoBlob || !canShareFiles) return false
    setIsSharing(true)
    try {
      const file = new File(
        [videoBlob],
        `get-lucky-shot.${fileExtension}`,
        { type: videoBlob.type || 'video/webm' }
      )
      await navigator.share({ title, text, url, files: [file] })
      return true
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return true // user cancelled = handled
      console.warn('[share] Video share failed, falling back:', err)
      return false
    } finally {
      setIsSharing(false)
    }
  }, [videoBlob, canShareFiles, fileExtension, title, text, url])

  const shareTextOnly = useCallback(async () => {
    if (!canShareText) return
    setIsSharing(true)
    try {
      await navigator.share({ title, text, url })
    } catch {
      // AbortError = user cancelled
    } finally {
      setIsSharing(false)
    }
  }, [canShareText, title, text, url])

  const downloadVideo = useCallback(() => {
    if (!videoBlob) return
    const blobUrl = URL.createObjectURL(videoBlob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = `get-lucky-shot.${fileExtension}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 3000)
  }, [videoBlob, fileExtension])

  return {
    canShareFiles,
    canShareText,
    hasVideo,
    isSharing,
    shareWithVideo,
    shareTextOnly,
    downloadVideo,
  }
}
