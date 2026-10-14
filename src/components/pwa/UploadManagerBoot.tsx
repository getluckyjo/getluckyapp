'use client'

import { useEffect } from 'react'
import { getUploadManager } from '@/lib/upload'

/**
 * Mounted once at the root: on every launch, put every shot the phone still
 * holds unsealed back on the upload manager's queue. The manager lives
 * outside React, so nothing a screen does can abandon an upload.
 */
export default function UploadManagerBoot() {
  useEffect(() => {
    void getUploadManager().recover()
  }, [])
  return null
}
