import { useSyncExternalStore } from 'react'
import { getUploadState, subscribeUploads } from '@/lib/upload-store'

/** The app-level upload state (queue, refusals, banners, the bar's session). */
export const useUploads = () => useSyncExternalStore(subscribeUploads, getUploadState)
