'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { initErudaMobileDevTools } from '@/lib/runtime/mobile-devtools'
import { remotePlayLogger } from '@/lib/runtime/remote-play-logger'

export function useRemoteEnvironment(connected: boolean, resume: () => void) {
  const [isIdle, setIsIdle] = useState(false)
  const [isPortrait, setIsPortrait] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetIdleTimer = useCallback(() => {
    setIsIdle(false)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => setIsIdle(true), 8000)
  }, [])

  useEffect(() => {
    remotePlayLogger.initEnvironmentDiagnostics()
    remotePlayLogger.installGlobalErrorHandlers()
    resetIdleTimer()
    const orientation = () => setIsPortrait(window.innerHeight > window.innerWidth)
    const display = () => {
      const standalone = Boolean(
        (navigator as Navigator & { standalone?: boolean }).standalone ||
        window.matchMedia?.('(display-mode: standalone)').matches ||
        window.matchMedia?.('(display-mode: fullscreen)').matches
      )
      setIsStandalone(standalone)
      setIsFullscreen(standalone || Boolean(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement))
    }
    orientation()
    display()
    const media = window.matchMedia?.('(display-mode: standalone)')
    media?.addEventListener?.('change', display)
    document.addEventListener('fullscreenchange', display)
    document.addEventListener('webkitfullscreenchange', display)
    window.addEventListener('resize', orientation)
    window.addEventListener('orientationchange', orientation)
    window.addEventListener('pointerdown', resetIdleTimer, { passive: true })
    window.addEventListener('pointermove', resetIdleTimer, { passive: true })
    window.addEventListener('keydown', resetIdleTimer, { passive: true })
    try {
      const query = new URLSearchParams(window.location.search)
      if (query.get('debug') === '1' || query.get('eruda') === '1' || localStorage.getItem('chaya_remote_play_devtools') === '1') void initErudaMobileDevTools()
    } catch {
      /* Storage can be disabled in private browsing. */
    }
    return () => {
      media?.removeEventListener?.('change', display)
      document.removeEventListener('fullscreenchange', display)
      document.removeEventListener('webkitfullscreenchange', display)
      window.removeEventListener('resize', orientation)
      window.removeEventListener('orientationchange', orientation)
      window.removeEventListener('pointerdown', resetIdleTimer)
      window.removeEventListener('pointermove', resetIdleTimer)
      window.removeEventListener('keydown', resetIdleTimer)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [resetIdleTimer])

  useEffect(() => {
    let disposed = false
    let lock: WakeLockSentinel | null = null
    let acquiring = false
    const acquire = async () => {
      if (!connected || disposed || acquiring || (lock && !lock.released) || !navigator.wakeLock) return
      acquiring = true
      try {
        const next = await navigator.wakeLock.request('screen')
        if (disposed) void next.release()
        else lock = next
      } catch {
        /* Wake Lock may be unavailable over LAN HTTP or after a system lock. */
      } finally {
        acquiring = false
      }
    }
    const onResume = () => {
      if (document.visibilityState !== 'visible') return
      void acquire()
      resume()
    }
    void acquire()
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('pageshow', onResume)
    window.addEventListener('focus', onResume)
    return () => {
      disposed = true
      if (lock) void lock.release().catch(() => {})
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('pageshow', onResume)
      window.removeEventListener('focus', onResume)
    }
  }, [connected, resume])

  return { isIdle, isPortrait, isStandalone, isFullscreen, resetIdleTimer }
}
