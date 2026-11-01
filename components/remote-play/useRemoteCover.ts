'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { remotePlayLogger } from '@/lib/runtime/remote-play-logger'

const STORAGE_KEY = 'chaya_remote_play_covers_v1'
type Snapshot = { image: string; savedAt: number }

function isBlankOrBlackFrame(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  if (typeof context.getImageData !== 'function') return false
  try {
    const samples = [
      [Math.floor(width / 2), Math.floor(height / 2)],
      [Math.floor(width / 4), Math.floor(height / 4)],
      [Math.floor((3 * width) / 4), Math.floor(height / 4)],
      [Math.floor(width / 4), Math.floor((3 * height) / 4)],
      [Math.floor((3 * width) / 4), Math.floor((3 * height) / 4)],
      [Math.floor(width / 2), Math.floor(height / 4)],
      [Math.floor(width / 2), Math.floor((3 * height) / 4)],
    ]
    let maxLum = 0
    let totalLum = 0
    for (const [x, y] of samples) {
      const p = context.getImageData(x, y, 1, 1).data
      const lum = 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
      if (lum > maxLum) maxLum = lum
      totalLum += lum
    }
    const avgLum = totalLum / samples.length
    return maxLum < 32 || avgLum < 24
  } catch {
    return false
  }
}

function readSnapshots(): Record<string, Snapshot> {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    return Object.fromEntries(
      Object.entries(data).filter(([, value]) => value && typeof value.savedAt === 'number' && typeof value.image === 'string' && value.image.startsWith('data:image/jpeg;base64,'))
    )
  } catch {
    return {}
  }
}

export function useRemoteCover(gameId: string | undefined, videoRef: RefObject<HTMLVideoElement | null>) {
  const [cover, setCover] = useState<{ gameId: string; image: string | null } | null>(null)
  const coversRef = useRef(new Map<string, string | null>())
  const snapshotsRef = useRef(new Map<string, Snapshot>())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!gameId) return
    const controller = new AbortController()
    const snapshot = readSnapshots()[gameId]
    if (snapshot) snapshotsRef.current.set(gameId, snapshot)
    setCover({ gameId, image: coversRef.current.get(gameId) || snapshot?.image || null })

    if (!coversRef.current.has(gameId)) {
      void fetch(`/api/game/cover?gameId=${encodeURIComponent(gameId)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (controller.signal.aborted) return
          const image = typeof data?.cover === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/.test(data.cover) ? data.cover : null
          coversRef.current.set(gameId, image)
          setCover({ gameId, image: image || snapshotsRef.current.get(gameId)?.image || null })
        })
        .catch(() => {
          if (!controller.signal.aborted) coversRef.current.set(gameId, null)
        })
    }
    return () => controller.abort()
  }, [gameId])

  const captureCover = useCallback(() => {
    const video = videoRef.current
    if (!gameId || !video?.videoWidth || !video.videoHeight || video.readyState < 2) return
    // Static artwork always wins. Only capture a fallback after the artwork request settles.
    if (!coversRef.current.has(gameId) || coversRef.current.get(gameId)) return
    const previous = snapshotsRef.current.get(gameId)
    if (previous && Date.now() - previous.savedAt < 180_000) return
    try {
      const canvas = document.createElement('canvas')
      canvas.width = Math.min(960, video.videoWidth)
      canvas.height = Math.round((canvas.width * video.videoHeight) / video.videoWidth)
      const context = canvas.getContext('2d')
      if (!context) return
      context.drawImage(video, 0, 0, canvas.width, canvas.height)

      // Guard against black screen or blank video capture (common during video/stream initialization)
      if (isBlankOrBlackFrame(context, canvas.width, canvas.height)) {
        return
      }

      const image = canvas.toDataURL('image/jpeg', 0.7)
      snapshotsRef.current.set(gameId, { image, savedAt: Date.now() })
      setCover({ gameId, image })
      try {
        const snapshots = { ...readSnapshots(), [gameId]: { image, savedAt: Date.now() } }
        const recent = Object.entries(snapshots)
          .sort(([, a], [, b]) => b.savedAt - a.savedAt)
          .slice(0, 4)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(recent)))
      } catch {
        /* The in-memory cover still works when storage is unavailable or full. */
      }
    } catch {
      remotePlayLogger.warn('Failed to capture stream cover')
    }
  }, [gameId, videoRef])

  const onPlaying = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    // Allow initial video decoder & game engine scene transition to settle before capturing
    timerRef.current = setTimeout(captureCover, 2400)
  }, [captureCover])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') captureCover()
    }
    window.addEventListener('pagehide', captureCover)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', captureCover)
      document.removeEventListener('visibilitychange', onVisibility)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [captureCover])

  return { coverImage: cover && cover.gameId === gameId ? cover.image : null, captureCover, onPlaying }
}
