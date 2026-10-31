'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  LuActivity,
  LuCheck,
  LuCompass,
  LuGamepad2,
  LuLoader,
  LuMaximize2,
  LuMinimize2,
  LuMousePointer2,
  LuPlay,
  LuRotateCcw,
  LuRotateCw,
  LuScaling,
  LuScrollText,
  LuSlidersHorizontal,
  LuSparkles,
  LuVolume2,
  LuVolumeX,
  LuX,
} from 'react-icons/lu'

import type { GameLinkMessage, RemoteInputKey } from '@/lib/runtime/game-link-protocol'
import { initErudaMobileDevTools } from '@/lib/runtime/mobile-devtools'
import { remotePlayLogger } from '@/lib/runtime/remote-play-logger'
import { WebGameLink } from '@/lib/runtime/web-game-link'

import { useT } from '@/components/i18n/LocaleProvider'
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher'
import { GradientButton } from '@/components/sk'
import { IoHandLeftOutline, IoHandRightOutline, IoPlayOutline } from 'react-icons/io5'
import { LuMonitor, LuPower, LuSmartphone } from 'react-icons/lu'
import { IosInstallGuideModal } from './IosInstallGuideModal'
import { PerformanceHud } from './PerformanceHud'
import { RemoteCheatDrawer } from './RemoteCheatDrawer'
import { type ControlMode, VirtualController } from './VirtualController'

type RemotePlayViewProps = {
  initialRoomId?: string
}

type StatusToast = {
  type: 'connected' | 'disconnected' | 'connecting' | 'info'
  text: string
  exiting?: boolean
}

type LibraryItem = {
  id: string
  name: string
  gameRoot: string
  remote?: boolean
  missing?: boolean
  kindLabel?: string
  pathLabel?: string
  hasShell?: boolean
  fingerprint?: {
    engine?: { name?: string; version?: string }
  }
}

export function RemotePlayView({ initialRoomId }: RemotePlayViewProps) {
  const t = useT()
  const [roomId, setRoomId] = useState<string>(initialRoomId || '')
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [muted, setMuted] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<'cheat' | 'logs'>('cheat')
  const [videoResolution, setVideoResolution] = useState<{ width: number; height: number } | null>(null)
  const [hudVisible, setHudVisible] = useState(false)
  const [isIdle, setIsIdle] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [installGuideOpen, setInstallGuideOpen] = useState(false)
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain')
  const [isPortrait, setIsPortrait] = useState(false)

  // Unified Menu Modal (Single Button trigger)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuTab, setMenuTab] = useState<'gamepad' | 'quick' | 'display' | 'system'>('gamepad')

  // Control Mode: fixed, dynamic, single-left, single-right, touch
  const [controlMode, setControlMode] = useState<ControlMode>('fixed')
  const [clientMode, setClientMode] = useState<'auto' | 'desktop' | 'mobile'>('auto')
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false)
  const [quitConfirmOpen, setQuitConfirmOpen] = useState(false)
  const [desktopToolbarVisible, setDesktopToolbarVisible] = useState(true)

  // Auto-reconnect & toast states
  const [isCancelled, setIsCancelled] = useState(false)
  const [statusToast, setStatusToast] = useState<StatusToast | null>(null)
  const [coverImage, setCoverImage] = useState<string | null>(null)

  // Game server status & launcher states
  const [gameOnline, setGameOnline] = useState<boolean | null>(null)
  const [isLaunching, setIsLaunching] = useState(false)
  const [library, setLibrary] = useState<LibraryItem[]>([])
  const [selectedGame, setSelectedGame] = useState<LibraryItem | null>(null)
  const [gameSelectorOpen, setGameSelectorOpen] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const linkRef = useRef<WebGameLink | null>(null)
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatusRef = useRef(status)

  const resetIdleTimer = useCallback(() => {
    setIsIdle(false)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      setIsIdle(true)
    }, 2800)
  }, [])

  const showStatusToast = useCallback(
    (type: 'connected' | 'disconnected' | 'connecting' | 'info', text: string, durationMs = 2800) => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
      if (toastExitTimerRef.current) clearTimeout(toastExitTimerRef.current)
      setStatusToast({ type, text, exiting: false })
      const exitDelay = Math.max(800, durationMs - 300)
      toastExitTimerRef.current = setTimeout(() => {
        setStatusToast((prev) => (prev ? { ...prev, exiting: true } : null))
        toastTimeoutRef.current = setTimeout(() => {
          setStatusToast(null)
        }, 300)
      }, exitDelay)
    },
    []
  )

  const handleInput = useCallback((key: RemoteInputKey, action: 'down' | 'up') => {
    linkRef.current?.send({
      type: 'remote.input',
      key,
      action,
    })
  }, [])

  const isDesktop =
    clientMode === 'desktop' ||
    (clientMode === 'auto' && typeof window !== 'undefined' && !remotePlayLogger.getDiagnostics().isMobile)

  // Keyboard handler for PC desktop streaming (Requirement 8)
  useEffect(() => {
    if (status !== 'connected' || !isDesktop) return

    const keyMap: Record<string, RemoteInputKey> = {
      ArrowUp: 'up',
      KeyW: 'up',
      ArrowDown: 'down',
      KeyS: 'down',
      ArrowLeft: 'left',
      KeyA: 'left',
      ArrowRight: 'right',
      KeyD: 'right',
      Enter: 'ok',
      Space: 'ok',
      KeyZ: 'ok',
      Escape: 'cancel',
      KeyX: 'cancel',
      Numpad0: 'cancel',
      Tab: 'menu',
      KeyM: 'menu',
      ShiftLeft: 'shift',
      ShiftRight: 'shift',
      KeyQ: 'pageup',
      KeyE: 'pagedown',
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const mapped = keyMap[e.code]
      if (mapped) {
        e.preventDefault()
        handleInput(mapped, 'down')
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const mapped = keyMap[e.code]
      if (mapped) {
        e.preventDefault()
        handleInput(mapped, 'up')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [status, isDesktop, handleInput])

  const executeHardReload = useCallback(() => {
    remotePlayLogger.info('User confirmed clear cache and hard reload')
    setReloadConfirmOpen(false)
    try {
      localStorage.removeItem('chaya_remote_control_mode')
      localStorage.removeItem('chaya_remote_client_mode')
      localStorage.removeItem('chaya_remote_fit_mode')
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
    window.location.href = window.location.pathname + '?_t=' + Date.now()
  }, [])

  const executeQuitGame = useCallback(async () => {
    remotePlayLogger.info('User confirmed quitting game')
    setQuitConfirmOpen(false)
    setMenuOpen(false)
    try {
      if (linkRef.current) {
        linkRef.current.send({ type: 'quit' })
        linkRef.current.stop()
        linkRef.current = null
      }
    } catch {
      /* ignore */
    }
    try {
      await fetch('/api/launch', { method: 'DELETE' })
    } catch {
      /* ignore */
    }
    setStatus('disconnected')
    setGameOnline(false)
    showStatusToast('info', t('play.gameExited'), 3000)
  }, [showStatusToast, t])

  const handleClearCacheAndReload = useCallback(async () => {
    remotePlayLogger.info('User triggered clear cache and reload')
    try {
      if (typeof window !== 'undefined') {
        localStorage.clear()
        sessionStorage.clear()
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map((k) => caches.delete(k)))
        }
      }
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined') {
      window.location.replace(window.location.pathname + '?_ts=' + Date.now())
    }
  }, [])

  const clearReconnectTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  // 0. Environment diagnostics, orientation, saved cover & preferences
  useEffect(() => {
    remotePlayLogger.initEnvironmentDiagnostics()
    remotePlayLogger.installGlobalErrorHandlers()
    remotePlayLogger.info('Remote play view mounted')
    resetIdleTimer()

    const handleActivity = () => {
      resetIdleTimer()
    }
    window.addEventListener('pointerdown', handleActivity, { passive: true })
    window.addEventListener('pointermove', handleActivity, { passive: true })
    window.addEventListener('keydown', handleActivity, { passive: true })

    const updateOrientation = () => {
      if (typeof window === 'undefined') return
      setIsPortrait(window.innerHeight > window.innerWidth)
    }
    updateOrientation()
    window.addEventListener('resize', updateOrientation, { passive: true })
    window.addEventListener('orientationchange', updateOrientation, { passive: true })

    const checkDisplayState = () => {
      if (typeof window === 'undefined') return
      const nav = window.navigator as { standalone?: boolean }
      const standalone = Boolean(
        nav?.standalone === true ||
          window.matchMedia?.('(display-mode: standalone)').matches ||
          window.matchMedia?.('(display-mode: fullscreen)').matches
      )
      const doc = document as Document & { webkitFullscreenElement?: Element }
      const standardFs = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement)
      setIsStandalone(standalone)
      setIsFullscreen(standalone || standardFs)
    }

    checkDisplayState()
    document.addEventListener('fullscreenchange', checkDisplayState)
    document.addEventListener('webkitfullscreenchange', checkDisplayState)

    try {
      const mql = window.matchMedia('(display-mode: standalone)')
      mql.addEventListener?.('change', checkDisplayState)
    } catch {
      /* ignore */
    }

    // Load saved preferences & cover image
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search)
      if (
        q.get('debug') === '1' ||
        q.get('eruda') === '1' ||
        localStorage.getItem('chaya_remote_play_devtools') === '1'
      ) {
        void initErudaMobileDevTools()
      }
      if (localStorage.getItem('chaya_remote_play_hud') === '1') {
        setHudVisible(true)
      }
      try {
        const savedFit = localStorage.getItem('chaya_remote_play_fit')
        if (savedFit === 'cover' || savedFit === 'contain') {
          setFitMode(savedFit)
        }
        const savedMode = localStorage.getItem('chaya_remote_control_mode') as ControlMode
        if (savedMode === 'fixed' || savedMode === 'touch' || savedMode === 'dynamic') {
          setControlMode(savedMode)
        }
        const cachedCover = localStorage.getItem('chaya_remote_play_cover')
        if (cachedCover) {
          setCoverImage(cachedCover)
        }
      } catch {
        /* ignore */
      }

      // Fetch official game cover / loading image from backend API
      void fetch('/api/game/cover')
        .then((res) => res.json())
        .then((data) => {
          if (data?.cover) {
            setCoverImage(data.cover)
          }
        })
        .catch(() => {})
    }

    return () => {
      document.removeEventListener('fullscreenchange', checkDisplayState)
      document.removeEventListener('webkitfullscreenchange', checkDisplayState)
      window.removeEventListener('resize', updateOrientation)
      window.removeEventListener('orientationchange', updateOrientation)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
      window.removeEventListener('pointerdown', handleActivity)
      window.removeEventListener('pointermove', handleActivity)
      window.removeEventListener('keydown', handleActivity)
    }
  }, [resetIdleTimer])

  // 1. Toast notifications on connection status changes
  useEffect(() => {
    if (prevStatusRef.current !== status) {
      const prev = prevStatusRef.current
      prevStatusRef.current = status

      if (status === 'connected') {
        showStatusToast('connected', t('play.connected'))
      } else if (status === 'disconnected') {
        if (gameOnline) {
          showStatusToast('disconnected', `${t('play.disconnected')}...`, 3000)
        }
      } else if (status === 'connecting' && prev === 'disconnected') {
        showStatusToast('connecting', t('play.connecting'), 2000)
      }
    }
  }, [status, gameOnline, showStatusToast])

  // 2. Resolve room ID, game library & check if game is online
  useEffect(() => {
    let cancelled = false
    remotePlayLogger.info('Probing game status from /api/status...')
    void fetch('/api/status')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const isOnline = Boolean(data?.runtime?.gameOnline)
        setGameOnline(isOnline)

        const lib = (data?.library || []) as LibraryItem[]
        setLibrary(lib)

        const selected = data?.selected
        const current =
          lib.find((item) => (initialRoomId ? item.id === initialRoomId : item.gameRoot === selected)) ||
          lib.find((item) => item.gameRoot === selected) ||
          lib[0] ||
          null
        setSelectedGame(current)

        const detectedId =
          initialRoomId ||
          current?.id ||
          data?.config?.library?.[0]?.id ||
          data?.resolved?.gameId ||
          'default'

        remotePlayLogger.ok(`Detected game room: ${detectedId} (online: ${isOnline})`, {
          gameId: detectedId,
          selected,
          name: current?.name,
          online: isOnline,
        })
        setRoomId(detectedId)
        if (!isOnline) {
          setStatus('disconnected')
        }
      })
      .catch((err) => {
        const msg = `Failed to get game status: ${err instanceof Error ? err.message : String(err)}`
        remotePlayLogger.fail(msg)
        if (!cancelled) setErrorMessage(msg)
      })
    return () => {
      cancelled = true
    }
  }, [initialRoomId])

  // 3. WebRTC Link Connection & Continuous Silent Auto-reconnect
  const connect = useCallback(
    (isManual = false) => {
      if (!roomId) return
      clearReconnectTimers()
      setIsCancelled(false)

      setStatus('connecting')
      setErrorMessage(null)

      if (isManual) {
        remotePlayLogger.info('User manually reconnected stream')
      } else {
        remotePlayLogger.info(`Establishing WebRTC stream connection (room: ${roomId})`)
      }

      linkRef.current?.stop()

      const scheduleSilentAutoReconnect = () => {
        clearReconnectTimers()
        reconnectTimerRef.current = setTimeout(() => {
          remotePlayLogger.info('Auto-reconnecting WebRTC stream...')
          connect(false)
        }, 2600)
      }

      const link = new WebGameLink(roomId, {
        onLog: (level, msg, meta) => {
          remotePlayLogger.add(level, msg, meta)
        },
        onConnected: () => {
          clearReconnectTimers()
          setIsCancelled(false)
          setStatus('connected')
          setGameOnline(true)
          remotePlayLogger.ok('WebRTC stream link established successfully')
          setErrorMessage(null)
        },
        onDisconnected: () => {
          setStatus('disconnected')
          setLatencyMs(null)
          remotePlayLogger.warn('WebRTC stream disconnected, auto-reconnecting silently')
          scheduleSilentAutoReconnect()
        },
        onTrack: (stream: MediaStream) => {
          streamRef.current = stream
          remotePlayLogger.ok(`Received remote media stream with ${stream.getTracks().length} tracks`, {
            tracks: stream.getTracks().map((t) => ({ kind: t.kind, label: t.label, readyState: t.readyState })),
          })
          if (!videoRef.current) return
          if (videoRef.current.srcObject !== stream) {
            videoRef.current.srcObject = stream
          }
          void videoRef.current
            .play()
            .then(() => {
              remotePlayLogger.ok('Video playback started')
            })
            .catch((err) => {
              remotePlayLogger.warn(
                `Autoplay blocked by browser policy (user tap required): ${
                  err instanceof Error ? err.message : String(err)
                }`
              )
            })
        },
        onMessage: (msg: GameLinkMessage) => {
          if (msg.type === 'pong') {
            const rtt = Date.now() - msg.t
            setLatencyMs(Math.max(1, Math.round(rtt / 2)))
          }
        },
        onIdle: () => {
          remotePlayLogger.warn('Signaling waiting for game response, retrying...')
          setStatus((prev) => (prev === 'connected' ? prev : 'disconnected'))
          scheduleSilentAutoReconnect()
        },
      })

      linkRef.current = link

      void link.start({ enableMedia: true, takeover: true }).catch((err) => {
        const errStr = `WebRTC connection handshake exception: ${err instanceof Error ? err.message : String(err)}`
        remotePlayLogger.fail(errStr)
        setStatus('disconnected')
        setErrorMessage(errStr)
        scheduleSilentAutoReconnect()
      })
    },
    [roomId, clearReconnectTimers]
  )

  useEffect(() => {
    if (!roomId) return
    if (gameOnline === false) {
      setStatus('disconnected')
      return
    }
    if (gameOnline === true) {
      connect(false)
    }

    pingTimerRef.current = setInterval(() => {
      if (linkRef.current?.connected) {
        linkRef.current.send({ type: 'ping', t: Date.now() })
      }
    }, 2500)

    return () => {
      clearReconnectTimers()
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      linkRef.current?.stop()
      linkRef.current = null
    }
  }, [roomId, gameOnline, connect, clearReconnectTimers])

  // One-click game launch & auto-connect polling
  const handleLaunchGame = useCallback(async () => {
    if (isLaunching) return
    setIsLaunching(true)
    remotePlayLogger.info('User initiated game launch via POST /api/launch...')
    showStatusToast('connecting', t('play.launchingLocalGame'), 8000)

    try {
      const res = await fetch('/api/launch', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.ok === false) {
        const errMsg = data?.error?.message || data?.error || 'Failed to launch game'
        remotePlayLogger.fail(`Game launch failed: ${errMsg}`)
        showStatusToast('disconnected', `${t('play.failed')}: ${errMsg}`, 4000)
        setIsLaunching(false)
        return
      }

      if (data.alreadyRunning) {
        remotePlayLogger.ok('Game already running, connecting directly to WebRTC stream')
        showStatusToast('connecting', t('play.connecting'), 3000)
        setGameOnline(true)
        setIsLaunching(false)
        connect(true)
        return
      }

      remotePlayLogger.ok('Game process spawned, awaiting WebRTC stream readiness...')
      showStatusToast('connecting', t('play.connecting'), 6000)

      let attempts = 0
      const maxAttempts = 30
      const pollInterval = setInterval(async () => {
        attempts += 1
        try {
          const stRes = await fetch('/api/status')
          const stData = await stRes.json()
          const isOnline = Boolean(stData?.runtime?.gameOnline)
          if (isOnline) {
            clearInterval(pollInterval)
            setGameOnline(true)
            setIsLaunching(false)
            remotePlayLogger.ok('Game detected online, connecting to WebRTC stream')
            connect(true)
            return
          }
        } catch {
          /* ignore */
        }

        if (attempts >= maxAttempts) {
          clearInterval(pollInterval)
          setIsLaunching(false)
          remotePlayLogger.warn('Timed out waiting for game online, entering reconnection standby')
          showStatusToast('disconnected', t('play.pausedConnecting'), 4000)
        }
      }, 1200)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      remotePlayLogger.fail(`Launch request encountered exception: ${errMsg}`)
      showStatusToast('disconnected', `${t('play.failed')}: ${errMsg}`, 4000)
      setIsLaunching(false)
    }
  }, [isLaunching, showStatusToast, connect])

  // Game switching handler
  const handleSelectGame = useCallback(
    async (game: LibraryItem) => {
      remotePlayLogger.info(`Switched target game to: ${game.name} (${game.gameRoot})`)
      // Switch game: reset connection and mark disconnected
      clearReconnectTimers()
      linkRef.current?.stop()
      linkRef.current = null
      setStatus('disconnected')
      setGameOnline(false)
      try {
        const res = await fetch('/api/status', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameRoot: game.gameRoot }),
        })
        const data = await res.json()
        if (!res.ok || data.ok === false) {
          showStatusToast('disconnected', `${t('play.switchGame')} ${t('play.failed')}`, 3000)
          return
        }
        setSelectedGame(game)
        setRoomId(game.id)
        setGameSelectorOpen(false)
        showStatusToast('info', `${t('play.switchGame')}: ${game.name}`, 2500)

        const stRes = await fetch('/api/status')
        const stData = await stRes.json()
        const isOnline = Boolean(stData?.runtime?.gameOnline)
        setGameOnline(isOnline)
        if (isOnline) {
          connect(true)
        } else {
          setStatus('disconnected')
        }
      } catch {
        showStatusToast('disconnected', `${t('play.switchGame')} ${t('play.failed')}`, 3000)
      }
    },
    [showStatusToast, connect]
  )

  // 4. Remote input dispatch defined above

  // 5. Direct canvas touch on video
  const handleVideoPointer = (e: React.PointerEvent<HTMLVideoElement>, phase: 'down' | 'move' | 'up') => {
    const video = videoRef.current
    if (!video || !linkRef.current?.connected) return
    const rect = video.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

    linkRef.current.send({
      type: 'remote.tap',
      x: normX,
      y: normY,
      phase,
    })
  }

  // 6. Capture live game frame to update background cover
  const handleCaptureVideoCover = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return
    try {
      const canvas = document.createElement('canvas')
      canvas.width = Math.min(640, video.videoWidth)
      canvas.height = Math.round((canvas.width * video.videoHeight) / video.videoWidth)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
        setCoverImage(dataUrl)
        localStorage.setItem('chaya_remote_play_cover', dataUrl)
      }
    } catch {
      /* ignore */
    }
  }

  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    if (el) {
      el.muted = true
      el.playsInline = true
      el.setAttribute('playsinline', 'true')
      el.setAttribute('webkit-playsinline', 'true')
      el.setAttribute('x5-playsinline', 'true')
      if (streamRef.current && el.srcObject !== streamRef.current) {
        el.srcObject = streamRef.current
        void el.play().catch(() => {})
      }
    }
  }, [])

  const handleGlobalPointerDown = () => {
    if (videoRef.current && videoRef.current.paused && videoRef.current.srcObject) {
      remotePlayLogger.info('User tapped screen to resume video playback')
      void videoRef.current.play().catch(() => {})
    }
  }

  // 7. Unmute audio on user tap
  const handleUnmute = () => {
    setMuted(false)
    remotePlayLogger.info('User unmuted stream audio')
    if (videoRef.current) {
      videoRef.current.muted = false
      void videoRef.current.play().catch(() => {})
    }
  }

  const toggleFullscreen = () => {
    resetIdleTimer()

    if (isStandalone) {
      setInstallGuideOpen(true)
      remotePlayLogger.info('Detected standalone PWA full-screen mode')
      return
    }

    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> }
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {})
      } else if (doc.webkitExitFullscreen) {
        void doc.webkitExitFullscreen().catch(() => {})
      }
      remotePlayLogger.info('User exited full-screen mode')
      return
    }

    const docEl = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>
    }
    const isIos =
      typeof navigator !== 'undefined' &&
      (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

    if (isIos || (!docEl.requestFullscreen && !docEl.webkitRequestFullscreen)) {
      setInstallGuideOpen(true)
      remotePlayLogger.info('Triggered iOS Safari Add to Home Screen guide')
      return
    }

    if (docEl.requestFullscreen) {
      docEl
        .requestFullscreen()
        .then(() => {
          remotePlayLogger.ok('Successfully entered browser fullscreen')
        })
        .catch(() => {
          setInstallGuideOpen(true)
        })
    } else if (docEl.webkitRequestFullscreen) {
      try {
        void docEl.webkitRequestFullscreen()
      } catch {
        setInstallGuideOpen(true)
      }
    } else {
      setInstallGuideOpen(true)
    }
  }

  const toggleFitMode = () => {
    resetIdleTimer()
    setFitMode((prev) => {
      const next = prev === 'contain' ? 'cover' : 'contain'
      try {
        localStorage.setItem('chaya_remote_play_fit', next)
      } catch {
        /* ignore */
      }
      remotePlayLogger.info(`Switched aspect ratio mode to: ${next}`)
      return next
    })
  }

  const handleToggleHud = () => {
    resetIdleTimer()
    setHudVisible((prev) => {
      const next = !prev
      try {
        localStorage.setItem('chaya_remote_play_hud', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const handleSelectControlMode = (mode: ControlMode) => {
    setControlMode(mode)
    try {
      localStorage.setItem('chaya_remote_control_mode', mode)
    } catch {
      /* ignore */
    }
    const modeLabel =
      mode === 'fixed'
        ? t('play.modeFixed')
        : mode === 'dynamic'
          ? t('play.modeDynamic')
          : mode === 'single-left'
            ? t('play.modeSingleLeft')
            : mode === 'single-right'
              ? t('play.modeSingleRight')
              : t('play.modeTouch')
    showStatusToast('connecting', modeLabel, 2000)
    remotePlayLogger.info(`Control mode switched to: ${mode}`)
  }

  const effectiveIdle = isIdle && status === 'connected' && !drawerOpen && !menuOpen

  const renderTabContent = () => {
    switch (menuTab) {
      case 'gamepad':
        return (
          <div className="space-y-3">
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              {t('play.controlModeTitle')}
            </div>
            {/* Joystick modes first, touch mode last. No explanatory descriptions (Requirement 1 & 2) */}
            <div className="grid grid-cols-5 gap-1 p-1 rounded-md bg-neutral-950/90 border border-white/10">
              <button
                type="button"
                onClick={() => handleSelectControlMode('fixed')}
                className={`flex flex-col items-center justify-center gap-1 rounded py-2 px-1 text-xs transition-all ${
                  controlMode === 'fixed'
                    ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 font-bold shadow-sm'
                    : 'text-neutral-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <LuGamepad2 size={16} />
                <span className="text-[10px] whitespace-nowrap">{t('play.modeFixed')}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectControlMode('dynamic')}
                className={`flex flex-col items-center justify-center gap-1 rounded py-2 px-1 text-xs transition-all ${
                  controlMode === 'dynamic'
                    ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 font-bold shadow-sm'
                    : 'text-neutral-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <LuCompass size={16} />
                <span className="text-[10px] whitespace-nowrap">{t('play.modeDynamic')}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectControlMode('single-left')}
                className={`flex flex-col items-center justify-center gap-1 rounded py-2 px-1 text-xs transition-all ${
                  controlMode === 'single-left'
                    ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 font-bold shadow-sm'
                    : 'text-neutral-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <IoHandLeftOutline size={16} />
                <span className="text-[10px] whitespace-nowrap">{t('play.modeSingleLeft')}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectControlMode('single-right')}
                className={`flex flex-col items-center justify-center gap-1 rounded py-2 px-1 text-xs transition-all ${
                  controlMode === 'single-right'
                    ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 font-bold shadow-sm'
                    : 'text-neutral-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <IoHandRightOutline size={16} />
                <span className="text-[10px] whitespace-nowrap">{t('play.modeSingleRight')}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectControlMode('touch')}
                className={`flex flex-col items-center justify-center gap-1 rounded py-2 px-1 text-xs transition-all ${
                  controlMode === 'touch'
                    ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 font-bold shadow-sm'
                    : 'text-neutral-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <LuMousePointer2 size={16} />
                <span className="text-[10px] whitespace-nowrap">{t('play.modeTouch')}</span>
              </button>
            </div>
          </div>
        )
      case 'quick':
        return (
          <div className="space-y-2 text-xs">
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
              {t('play.inGameControlTitle')}
            </div>
            <button
              type="button"
              onClick={() => {
                setDrawerTab('cheat')
                setDrawerOpen(true)
                setMenuOpen(false)
              }}
              className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3.5 py-2.5 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <LuSparkles size={16} className="text-amber-400 shrink-0" />
                <span className="font-semibold whitespace-nowrap">{t('play.inGameConsole')}</span>
              </span>
              <span className="text-[11px] text-neutral-400">{t('play.openPanel')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDrawerTab('logs')
                setDrawerOpen(true)
                setMenuOpen(false)
              }}
              className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3.5 py-2.5 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <LuScrollText size={16} className="text-sky-400 shrink-0" />
                <span className="font-semibold whitespace-nowrap">{t('play.diagLogs')}</span>
              </span>
              <span className="text-[11px] text-neutral-400">{t('play.viewLogs')}</span>
            </button>
          </div>
        )
      case 'display':
        return (
          <div className="space-y-2 text-xs">
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
              {t('play.audioVisualTitle')}
            </div>
            <button
              type="button"
              onClick={muted ? handleUnmute : () => setMuted(true)}
              className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                {muted ? (
                  <LuVolumeX size={15} className="text-amber-400 shrink-0" />
                ) : (
                  <LuVolume2 size={15} className="text-emerald-400 shrink-0" />
                )}
                <span className="whitespace-nowrap shrink-0">{t('play.audioOutput')}</span>
              </span>
              <span className={`text-[10px] font-semibold ${muted ? 'text-amber-300' : 'text-emerald-400'}`}>
                {muted ? t('play.muted') : t('play.unmuted')}
              </span>
            </button>

            <button
              type="button"
              onClick={toggleFitMode}
              className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <LuScaling size={15} className="text-sky-400 shrink-0" />
                <span className="whitespace-nowrap shrink-0">{t('play.scalingMode')}</span>
              </span>
              <span className="text-[10px] text-sky-300 font-mono">
                {fitMode === 'cover' ? t('play.fitCover') : t('play.fitContain')}
              </span>
            </button>

            <button
              type="button"
              onClick={handleToggleHud}
              className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <LuActivity
                  size={15}
                  className={hudVisible ? 'text-emerald-400 shrink-0' : 'text-neutral-500 shrink-0'}
                />
                <span className="whitespace-nowrap shrink-0">{t('play.perfHud')}</span>
              </span>
              <span className={`text-[10px] ${hudVisible ? 'text-emerald-400' : 'text-neutral-500'}`}>
                {hudVisible ? t('play.shown') : t('play.hidden')}
              </span>
            </button>

            {!isStandalone && (
              <button
                type="button"
                onClick={() => {
                  toggleFullscreen()
                  setMenuOpen(false)
                }}
                className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
              >
                <span className="flex items-center gap-2">
                  {isFullscreen ? (
                    <LuMinimize2 size={15} className="text-emerald-400 shrink-0" />
                  ) : (
                    <LuMaximize2 size={15} className="text-neutral-300 shrink-0" />
                  )}
                  <span className="whitespace-nowrap shrink-0">{t('play.fullscreen')}</span>
                </span>
                <span className="text-[10px] text-neutral-400">
                  {isFullscreen ? t('play.exitFullscreen') : t('play.iosAddHomeScreen')}
                </span>
              </button>
            )}
          </div>
        )
      case 'system':
        return (
          <div className="space-y-2 text-xs">
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1">
              {t('play.preferencesTitle')}
            </div>

            {/* Language Switcher inside Preferences Dialog (Requirement 5) */}
            <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-neutral-200">
              <span className="flex items-center gap-2">
                <span className="whitespace-nowrap shrink-0 font-medium">{t('locale.label')}</span>
              </span>
              <LocaleSwitcher className="shrink-0" />
            </div>

            {/* Client Mode Layout: PC Desktop vs Mobile (Requirement 8) */}
            <div className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-neutral-200">
              <div className="flex flex-col">
                <span className="font-medium whitespace-nowrap">{t('play.platformMode')}</span>
                <span className="text-[10px] text-neutral-400">
                  {isDesktop ? t('play.platformDesktop') : t('play.platformMobile')}
                </span>
              </div>
              <div className="flex items-center gap-1 rounded-md border border-white/10 bg-neutral-950 p-0.5">
                <button
                  type="button"
                  onClick={() => setClientMode('desktop')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${
                    clientMode === 'desktop' || (clientMode === 'auto' && isDesktop)
                      ? 'bg-sky-500/30 text-sky-200 border border-sky-400/40'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  <LuMonitor size={12} />
                  <span>PC</span>
                </button>
                <button
                  type="button"
                  onClick={() => setClientMode('mobile')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${
                    clientMode === 'mobile' || (clientMode === 'auto' && !isDesktop)
                      ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/40'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  <LuSmartphone size={12} />
                  <span>手机</span>
                </button>
              </div>
            </div>

            {isDesktop && (
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-[10px] text-neutral-400">
                {t('play.keyboardHints')}
              </div>
            )}

            {library.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setGameSelectorOpen(true)
                  setMenuOpen(false)
                }}
                className="flex w-full items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
              >
                <span className="flex items-center gap-2">
                  <LuGamepad2 size={15} className="text-emerald-400 shrink-0" />
                  <span className="whitespace-nowrap shrink-0 font-medium">{t('play.switchGame')}</span>
                </span>
                <span className="text-[10px] text-neutral-400 truncate max-w-[130px]">
                  {selectedGame?.name || t('play.tapToSelect')}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                setReloadConfirmOpen(true)
              }}
              className="flex w-full items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <LuRotateCcw size={15} className="text-amber-400 shrink-0" />
                <span className="whitespace-nowrap shrink-0 font-medium">{t('play.clearReload')}</span>
              </span>
              <span className="text-[10px] text-neutral-400">{t('play.clearReloadDesc')}</span>
            </button>

            {/* Quit Game Button (Requirement 7) */}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                setQuitConfirmOpen(true)
              }}
              className="flex w-full items-center justify-between rounded-lg border border-rose-500/30 bg-rose-950/20 px-3 py-2.5 text-rose-300 hover:bg-rose-900/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <LuPower size={15} className="text-rose-400 shrink-0" />
                <span className="whitespace-nowrap shrink-0 font-medium">{t('play.quitGame')}</span>
              </span>
              <span className="text-[10px] text-rose-400/80">{t('common.close')}</span>
            </button>
          </div>
        )
    }
  }

  return (
    <main
      onPointerDown={handleGlobalPointerDown}
      className="relative h-screen w-screen overflow-hidden bg-black select-none touch-none"
    >
      <style>{`
        @keyframes chaya-blink {
          0%, 42%, 46%, 100% { transform: scaleY(1); }
          44% { transform: scaleY(0.08); }
        }
        @keyframes chaya-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes dot-glow {
          0%, 20% { opacity: 0.15; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1.1); }
          80%, 100% { opacity: 0.15; transform: scale(0.85); }
        }
      `}</style>

      {/* 1. Status Change Toast */}
      {statusToast && (
        <div
          style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
          className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
        >
          <div
            role="status"
            className="flex items-center gap-2 rounded-full border border-white/15 bg-neutral-900/95 px-3.5 py-1.5 shadow-2xl backdrop-blur-md select-none animate-in fade-in slide-in-from-top-3 duration-200"
          >
            {statusToast.type === 'connected' ? (
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
            ) : statusToast.type === 'disconnected' ? (
              <span className="flex h-2 w-2 rounded-full bg-rose-500 shrink-0" />
            ) : (
              <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-ping shrink-0" />
            )}
            <span className="text-xs font-semibold text-neutral-100 whitespace-nowrap shrink-0">
              {statusToast.text}
            </span>
            {statusToast.type === 'connected' && latencyMs != null && (
              <span className="text-[10px] font-mono text-emerald-400 whitespace-nowrap shrink-0">
                {latencyMs}ms
              </span>
            )}
          </div>
        </div>
      )}

      {/* 2. Video Stream Rendering (Orientation adaptive) */}
      {isPortrait ? (
        /* Portrait Layout: Video at top, Gamepad below */
        <div className="flex h-full w-full flex-col">
          {/* Top Video Container */}
          <div
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
            className="relative w-full aspect-video max-h-[46vh] bg-neutral-950 flex items-center justify-center overflow-hidden shrink-0 border-b border-white/10"
          >
            <video
              ref={setVideoRef}
              autoPlay
              playsInline
              muted={muted}
              onLoadedMetadata={() => {
                const v = videoRef.current
                if (v && (v.videoWidth || v.videoHeight)) {
                  setVideoResolution({ width: v.videoWidth, height: v.videoHeight })
                  setTimeout(handleCaptureVideoCover, 1500)
                }
              }}
              onPointerDown={(e) => handleVideoPointer(e, 'down')}
              onPointerMove={(e) => handleVideoPointer(e, 'move')}
              onPointerUp={(e) => handleVideoPointer(e, 'up')}
              className={`h-full w-full cursor-crosshair touch-none transition-all duration-300 ${
                fitMode === 'cover' ? 'object-cover' : 'object-contain'
              }`}
              style={{ touchAction: 'none' }}
            />

            {/* Performance HUD in Top-Left */}
            {status === 'connected' && (
              <PerformanceHud
                visible={hudVisible}
                idle={effectiveIdle}
                isStandalone={isStandalone}
                latencyMs={latencyMs}
                videoResolution={videoResolution}
                status={status}
                muted={muted}
                onClose={() => setHudVisible(false)}
              />
            )}

            {/* ONLY ONE Menu Button in Top-Right */}
            {status === 'connected' && (
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                style={{
                  top: 'max(0.5rem, env(safe-area-inset-top))',
                  right: 'max(0.75rem, env(safe-area-inset-right))',
                }}
                className="pointer-events-auto absolute z-40 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-neutral-900/80 text-neutral-300 shadow-md backdrop-blur-md transition-colors hover:bg-neutral-800 active:scale-95 shrink-0"
                title={t('play.consoleTitle')}
                aria-label={t('play.consoleTitle')}
              >
                <LuSlidersHorizontal size={14} className="text-emerald-400" />
              </button>
            )}
          </div>

          {/* Dedicated Gamepad Area in Portrait (Hidden on PC Desktop) */}
          {status === 'connected' && !isDesktop && (
            <div className="flex-1 w-full relative">
              <VirtualController
                onInput={handleInput}
                visible={!isDesktop}
                idle={effectiveIdle}
                isPortrait={true}
                mode={controlMode}
              />
            </div>
          )}
        </div>
      ) : (
        /* Landscape Layout: Fullscreen video with ONE single menu button */
        <>
          <video
            ref={setVideoRef}
            autoPlay
            playsInline
            muted={muted}
            onLoadedMetadata={() => {
              const v = videoRef.current
              if (v && (v.videoWidth || v.videoHeight)) {
                setVideoResolution({ width: v.videoWidth, height: v.videoHeight })
                setTimeout(handleCaptureVideoCover, 1500)
              }
            }}
            onPointerDown={(e) => handleVideoPointer(e, 'down')}
            onPointerMove={(e) => handleVideoPointer(e, 'move')}
            onPointerUp={(e) => handleVideoPointer(e, 'up')}
            className={`fixed inset-0 h-full w-full cursor-crosshair touch-none transition-all duration-300 ${
              fitMode === 'cover' ? 'object-cover' : 'object-contain'
            }`}
            style={{ touchAction: 'none' }}
          />

          {status === 'connected' && (
            <>
              {/* Performance HUD in Top-Left */}
              <PerformanceHud
                visible={hudVisible}
                idle={effectiveIdle}
                isStandalone={isStandalone}
                latencyMs={latencyMs}
                videoResolution={videoResolution}
                status={status}
                muted={muted}
                onClose={() => setHudVisible(false)}
              />

              {/* PC Desktop Floating Top Toolbar (Requirement 8) */}
              {isDesktop ? (
                <div
                  style={{ top: 'max(0.5rem, env(safe-area-inset-top))' }}
                  className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
                >
                  <div
                    onMouseEnter={() => setDesktopToolbarVisible(true)}
                    className={`pointer-events-auto flex items-center gap-2 rounded-md border border-[rgb(230_238_248/0.15)] bg-neutral-900/90 px-3 py-1.5 shadow-2xl backdrop-blur-xl transition-all duration-300 ${
                      effectiveIdle && !desktopToolbarVisible
                        ? 'opacity-30 hover:opacity-100'
                        : 'opacity-90 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 pr-2 border-r border-white/10 text-xs">
                      <span className="flex h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-neutral-200 font-mono text-[11px] whitespace-nowrap">
                        {latencyMs != null ? `${latencyMs}ms` : t('play.connected')}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={muted ? handleUnmute : () => setMuted(true)}
                      className="p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10 transition-colors"
                      title={muted ? t('play.unmuted') : t('play.muted')}
                    >
                      {muted ? (
                        <LuVolumeX size={15} className="text-amber-400" />
                      ) : (
                        <LuVolume2 size={15} className="text-emerald-400" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={toggleFitMode}
                      className="p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10 transition-colors"
                      title={fitMode === 'cover' ? t('play.fitCover') : t('play.fitContain')}
                    >
                      <LuScaling size={15} className="text-sky-400" />
                    </button>

                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className="p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10 transition-colors"
                      title={t('play.fullscreen')}
                    >
                      {isFullscreen ? <LuMinimize2 size={15} /> : <LuMaximize2 size={15} />}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setDrawerTab('cheat')
                        setDrawerOpen(true)
                      }}
                      className="p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10 transition-colors"
                      title={t('play.consoleTitle')}
                    >
                      <LuSparkles size={15} className="text-amber-400" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setMenuOpen(true)}
                      className="p-1 rounded text-neutral-300 hover:text-white hover:bg-white/10 transition-colors"
                      title={t('play.preferencesTitle')}
                    >
                      <LuSlidersHorizontal size={15} className="text-emerald-400" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setQuitConfirmOpen(true)}
                      className="p-1 rounded text-rose-400 hover:text-rose-200 hover:bg-rose-950/50 transition-colors"
                      title={t('play.quitGame')}
                    >
                      <LuPower size={15} />
                    </button>

                    <span className="hidden lg:inline-flex text-[10px] text-neutral-400 pl-2 border-l border-white/10 select-none whitespace-nowrap">
                      {t('play.keyboardHints')}
                    </span>
                  </div>
                </div>
              ) : (
                /* Mobile Single Menu Button */
                <button
                  type="button"
                  onClick={() => setMenuOpen(true)}
                  style={{
                    top: 'max(0.5rem, env(safe-area-inset-top))',
                    right: 'max(0.75rem, env(safe-area-inset-right))',
                  }}
                  className={`pointer-events-auto fixed z-40 flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-neutral-900/85 text-neutral-300 shadow-xl backdrop-blur-md transition-all duration-300 hover:bg-neutral-800 active:scale-95 shrink-0 ${
                    effectiveIdle ? 'opacity-35 hover:opacity-100' : 'opacity-90 hover:opacity-100'
                  }`}
                  title={t('play.consoleTitle')}
                  aria-label={t('play.consoleTitle')}
                >
                  <LuSlidersHorizontal size={15} className="text-emerald-400" />
                </button>
              )}

              {/* Virtual D-Pad & Action Buttons (Hidden on PC Desktop) */}
              {!isDesktop && (
                <VirtualController
                  onInput={handleInput}
                  visible={!isDesktop}
                  idle={effectiveIdle}
                  isPortrait={false}
                  mode={controlMode}
                />
              )}
            </>
          )}
        </>
      )}

      {/* 3. Unified Control Menu Modal (Safe for Dynamic Island, Sidebar navigation in Landscape, Tab bar in Portrait) */}
      {menuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="menu-title"
          style={{
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
            paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
            paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm select-none"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className={`relative flex flex-col rounded-lg border border-[rgb(230_238_248/0.12)] bg-neutral-900/95 text-neutral-200 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden ${
              isPortrait
                ? 'w-full max-w-sm max-h-[85vh]'
                : 'w-full max-w-2xl'
            }`}
            style={{
              maxHeight: isPortrait ? '85vh' : 'min(380px, 88vh)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: Centered title, compressed height, clean icon button */}
            <div className="relative flex items-center justify-center py-1.5 px-8 border-b border-white/10 shrink-0">
              <h3 id="menu-title" className="text-xs font-bold text-white text-center leading-none">
                {t('play.consoleTitle')}
              </h3>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-white active:scale-90 transition-all"
                aria-label={t('common.close')}
              >
                <LuX size={15} />
              </button>
            </div>

            {/* Body */}
            {isPortrait ? (
              /* Portrait: Top Tab Bar + Scrollable Content */
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <div className="grid grid-cols-4 gap-2 p-1.5 bg-neutral-950/70 border-b border-white/10 shrink-0">
                  <button
                    type="button"
                    onClick={() => setMenuTab('gamepad')}
                    className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-lg text-[10px] font-semibold transition-all ${
                      menuTab === 'gamepad'
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-400/40 shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    <LuGamepad2 size={14} className="mb-0.5" />
                    <span>{t('play.gamepadTab')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuTab('quick')}
                    className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-lg text-[10px] font-semibold transition-all ${
                      menuTab === 'quick'
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-400/40 shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    <LuSparkles size={14} className="mb-0.5 text-amber-400" />
                    <span>{t('play.quickTab')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuTab('display')}
                    className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-lg text-[10px] font-semibold transition-all ${
                      menuTab === 'display'
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-400/40 shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    <LuSlidersHorizontal size={14} className="mb-0.5 text-sky-400" />
                    <span>{t('play.displayTab')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuTab('system')}
                    className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-lg text-[10px] font-semibold transition-all ${
                      menuTab === 'system'
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-400/40 shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    <LuRotateCcw size={14} className="mb-0.5 text-teal-400" />
                    <span>{t('play.systemTab')}</span>
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-3.5">
                  {renderTabContent()}
                </div>
              </div>
            ) : (
              /* Landscape: Left Sidebar Tabs + Right Scrollable Content */
              <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
                <div className="w-32 shrink-0 border-r border-white/10 p-2 space-y-2 bg-neutral-950/60 flex flex-col justify-start">
                  <button
                    type="button"
                    onClick={() => setMenuTab('gamepad')}
                    className={`flex items-center gap-2 w-full rounded-xl px-2.5 py-2 text-xs font-semibold transition-all ${
                      menuTab === 'gamepad'
                        ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 shadow-sm'
                        : 'text-neutral-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <LuGamepad2 size={15} />
                    <span className="whitespace-nowrap">{t('play.gamepadTab')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuTab('quick')}
                    className={`flex items-center gap-2 w-full rounded-xl px-2.5 py-2 text-xs font-semibold transition-all ${
                      menuTab === 'quick'
                        ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 shadow-sm'
                        : 'text-neutral-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <LuSparkles size={15} className="text-amber-400" />
                    <span className="whitespace-nowrap">{t('play.quickTab')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuTab('display')}
                    className={`flex items-center gap-2 w-full rounded-xl px-2.5 py-2 text-xs font-semibold transition-all ${
                      menuTab === 'display'
                        ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 shadow-sm'
                        : 'text-neutral-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <LuSlidersHorizontal size={15} className="text-sky-400" />
                    <span className="whitespace-nowrap">{t('play.displayTab')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuTab('system')}
                    className={`flex items-center gap-2 w-full rounded-xl px-2.5 py-2 text-xs font-semibold transition-all ${
                      menuTab === 'system'
                        ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 shadow-sm'
                        : 'text-neutral-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <LuRotateCcw size={15} className="text-teal-400" />
                    <span className="whitespace-nowrap">{t('play.systemTab')}</span>
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4">
                  {renderTabContent()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Cinematic Loading & Reconnecting Screen (Requirements 1, 2, 3, 4) */}
      {status !== 'connected' && (
        <div className="pointer-events-auto fixed inset-0 z-50 flex flex-col justify-between items-center select-none overflow-hidden">
          {/* Blurred Background: Game Cover / Live Snapshot (Requirement 4) */}
          {coverImage && (
            <div
              className="absolute inset-0 bg-cover bg-center scale-110 filter blur-2xl brightness-[0.26] contrast-125 opacity-75 transition-all duration-1000 pointer-events-none"
              style={{ backgroundImage: `url(${coverImage})` }}
            />
          )}

          {/* Dark Glassmorphic Vignette Overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-neutral-950/70 via-neutral-950/80 to-neutral-950/95 backdrop-blur-md pointer-events-none" />

          {/* Top Bar with Safe Area: Preferences & Clear Cache Button (Requirement 5) */}
          <div
            style={{
              top: 'max(0.75rem, env(safe-area-inset-top))',
              right: 'max(0.75rem, env(safe-area-inset-right))',
            }}
            className="pointer-events-auto fixed z-50 flex items-center gap-2"
          >
            <button
              type="button"
              onClick={() => {
                setMenuTab('system')
                setMenuOpen(true)
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-neutral-900/80 text-neutral-300 hover:text-white hover:bg-neutral-800 backdrop-blur-md active:scale-90 transition-all shadow-md"
              title={t('play.preferencesTitle')}
              aria-label={t('play.preferencesTitle')}
            >
              <LuSlidersHorizontal size={15} />
            </button>
            <button
              type="button"
              onClick={() => setReloadConfirmOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-neutral-900/80 text-sky-400 hover:text-white hover:bg-neutral-800 backdrop-blur-md active:scale-90 transition-all shadow-md"
              title={t('play.clearReload')}
              aria-label={t('play.clearReload')}
            >
              <LuRotateCcw size={15} />
            </button>
          </div>

          {/* Top spacer for safe area */}
          <div
            className="relative z-10 w-full shrink-0"
            style={{ height: 'max(1.5rem, env(safe-area-inset-top))' }}
          />

          {/* Center Mascot Logo Area (Borderless, no card frame, no dots) */}
          <div className="relative z-10 flex flex-col items-center justify-center flex-1 px-4 my-auto">
            <div className="relative flex items-center justify-center pointer-events-none select-none">
              <div className="absolute h-36 w-36 sm:h-44 sm:w-44 rounded-full bg-sky-400/20 blur-3xl animate-pulse pointer-events-none" />
              <div
                style={{ animation: 'chaya-float 3.6s ease-in-out infinite' }}
                className="relative flex items-center justify-center"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="205 195 650 650"
                  className="h-24 w-24 sm:h-32 sm:w-32 drop-shadow-[0_0_24px_rgba(42,212,255,0.7)]"
                  role="img"
                  aria-label="Logo"
                >
                  <path
                    id="chaya-body"
                    d="M605.5 707.18C611.96 713.13 617.68 720.4 623.54 726.95C625.35 728.98 627.12 731.53 629.31 733.16C632.88 735.83 638.47 735.39 640.8 731.27C644.06 725.47 640.15 711.1 642.5 703.55C661.66 698.57 680.22 692.7 697.77 683.3C708.24 677.69 719.82 667.34 730.84 664.43C739.89 662.05 750.21 663.35 759.5 663.37C771.33 663.39 786.74 662.15 798.14 663.48C806.74 664.48 813.76 672.09 814.7 680.56C815.39 686.75 814.83 693.26 814.85 699.5C814.89 712.83 814.89 726.17 814.86 739.5C814.84 751.17 815.24 762.87 805.97 771.47C797.61 779.23 778.67 783.69 767.61 787.2C734.37 797.74 700.15 805.92 665.5 810.15C641.5 813.07 617.68 815.28 593.5 816.05C559.23 817.15 524.65 817.14 490.5 813.9C413.41 806.59 329.49 778.24 281.51 713.97C264.22 690.81 251.66 662.03 247.26 633.46C243.58 609.53 245.44 584.63 245.39 560.5C245.36 539.83 245.36 519.17 245.39 498.5C245.43 463.07 245.42 436.24 260.78 403.32C273.19 376.71 292.19 351.84 316.17 334.65C336.07 320.4 359.16 310.35 381.04 299.53C404.67 287.84 428.24 275.98 451.97 264.47C470.79 255.35 489.47 245.94 508.24 236.73C519.11 231.4 529.62 225.33 541.75 223.4C565.96 219.56 588.16 235.32 608.76 245.72C653.96 268.54 699.4 290.91 744.42 314.08C755.87 319.98 767.34 325.97 778.96 331.53C787.99 335.85 798.37 339.67 804.54 347.94C814.2 360.89 811.01 386.7 810.92 402.5C810.88 409.53 812.15 417.69 809.9 424.45C804.75 439.89 785.11 436.19 772.5 436.2C766.93 436.21 761.03 436.69 755.5 436C744.3 434.59 727.44 421.44 716.37 416.15C682.99 400.21 649.74 384.01 616.28 368.24C602.44 361.72 588.68 355.01 574.74 348.74C566.4 344.99 558.91 340.46 549.5 340.12C532.38 339.49 515.58 351.7 500.81 359.35C473.75 373.34 446.29 386.61 419.41 400.93C406.12 408.01 391.76 413.46 381.57 425.09C373.24 434.61 366.7 445.39 363.27 457.66C360.27 468.37 360.48 479.49 360.46 490.5C360.45 502.17 360.49 513.83 360.45 525.5C360.37 544.17 360.55 562.83 360.44 581.5C360.36 595.79 359.27 610.5 363.23 624.39C366.67 636.49 373.39 647.54 381.36 657.18C402.94 683.29 434.54 699.19 467.58 704.7C483.43 707.35 499.49 707.23 515.5 707.2C529.83 707.17 544.17 707.23 558.5 707.2C574.17 707.17 589.83 707.3 605.5 707.18Z"
                    fill="#2AD4FF"
                    fillRule="evenodd"
                  />
                  <path
                    id="chaya-eyes"
                    style={{
                      transformBox: 'fill-box',
                      transformOrigin: 'center',
                      animation: 'chaya-blink 4.2s ease-in-out infinite',
                    }}
                    d="M537.25 448.5C537.61 465.12 535.84 481.89 535.23 498.5C534.13 528.47 533.7 558.63 531.36 588.53C530.03 605.39 533.33 626.66 519.25 638.72C509.62 646.97 497.34 645.75 485.5 645.75C477.83 645.74 470.17 645.75 462.5 645.75C449.53 645.76 428.18 648.43 417.07 641.44C400.93 631.29 403.1 615.13 403.06 598.5C402.98 564.83 403.06 531.17 403.06 497.5C403.06 485.79 400.08 461.49 408.55 453.04C416.66 444.93 431.14 447.7 441.5 447.74C462.83 447.8 484.17 447.75 505.5 447.73C514.54 447.72 529 446.22 537.25 448.5ZM558.5 447.82C589.1 446.84 619.89 447.58 650.5 447.71C660.68 447.76 677.53 445.02 685.69 451.85C695.69 460.21 692.35 484.18 692.34 496.5C692.31 530.5 692.38 564.5 692.35 598.5C692.33 614.35 694.06 631.61 678.74 641.26C667.69 648.21 647.34 645.55 634.5 645.58C624.5 645.6 614.5 645.56 604.5 645.58C594.13 645.61 584.08 645.93 575.81 638.66C565.86 629.91 565.48 618.86 564.89 606.5C564.63 601.16 564.16 595.85 563.97 590.5C562.84 557.85 561.39 525.13 559.75 492.5C559.29 483.17 558.85 473.83 558.31 464.5C558 459.08 557.11 453.01 558.5 447.82Z"
                    fill="#F0F7FF"
                    fillRule="evenodd"
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Bottom Centered Area: Game Launcher & Stream Entrance */}
          <div
            className="relative z-10 w-full shrink-0 flex flex-col items-center justify-center px-4"
            style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
          >
            {isLaunching ? (
              <div className="flex flex-col items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center gap-2">
                  <LuLoader size={18} className="animate-spin text-sky-400" />
                  <h2 className="text-base sm:text-lg font-black tracking-widest text-sky-300 font-mono animate-pulse drop-shadow-[0_0_14px_rgba(56,189,248,0.85)] whitespace-nowrap shrink-0">
                    LAUNCHING GAME…
                  </h2>
                </div>
                <p className="text-xs text-neutral-300/80 font-medium tracking-wide">
                  {t('play.launchingLocalGame')}
                </p>
              </div>
            ) : gameOnline === false ? (
              <div
                className={`w-full animate-in fade-in zoom-in-95 duration-200 ${
                  isPortrait
                    ? 'flex flex-col items-center gap-3 max-w-sm'
                    : 'flex items-center justify-between gap-3 max-w-2xl rounded-2xl border border-white/15 bg-neutral-900/90 px-4 py-2 backdrop-blur-md shadow-xl'
                }`}
              >
                {isPortrait ? (
                  <>
                    {/* Current Game Card */}
                    <div className="flex items-center justify-between w-full rounded-2xl border border-white/15 bg-neutral-900/85 px-4 py-2.5 backdrop-blur-md shadow-xl">
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className="text-[10px] text-neutral-400 flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          <span>{t('play.gameNotRunning')}</span>
                        </span>
                        <span className="text-xs sm:text-sm font-bold text-white truncate">
                          {selectedGame?.name || 'RPG Maker'}
                        </span>
                      </div>

                      {library.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setGameSelectorOpen(true)}
                          className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-neutral-300 hover:bg-white/10 hover:text-white shrink-0 active:scale-95 transition-all"
                        >
                          <LuGamepad2 size={13} className="text-emerald-400" />
                          <span>{t('play.switchGame')}</span>
                        </button>
                      )}
                    </div>

                    {/* App-styled Gradient Launch CTA Button */}
                    <GradientButton
                      size="lg"
                      variant="ok"
                      className="w-full justify-center min-h-12 shadow-[0_0_24px_rgba(16,185,129,0.5)]"
                      loading={isLaunching}
                      onClick={handleLaunchGame}
                    >
                      <IoPlayOutline size={19} aria-hidden />
                      <span>{t('play.launchAndStream')}</span>
                    </GradientButton>

                    <div className="flex items-center justify-center gap-4 text-xs pt-0.5">
                      <button
                        type="button"
                        onClick={() => connect(true)}
                        className="text-neutral-400 hover:text-neutral-200 text-[11px] underline underline-offset-2 transition-colors"
                      >
                        {t('play.directConnect')}
                      </button>
                      <span className="text-neutral-600">·</span>
                      <button
                        type="button"
                        onClick={() => {
                          setDrawerTab('logs')
                          setDrawerOpen(true)
                        }}
                        className="text-neutral-400 hover:text-neutral-200 text-[11px] transition-colors"
                      >
                        {t('play.diagLogs')}
                      </button>
                    </div>
                  </>
                ) : (
                  /* Landscape: Single Line */
                  <>
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0 animate-pulse" />
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-white truncate max-w-[200px]">
                          {selectedGame?.name || 'RPG Maker'}
                        </span>
                        <span className="text-[10px] text-neutral-400 shrink-0">{t('play.waitingLaunch')}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {library.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setGameSelectorOpen(true)}
                          className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-white/10 hover:text-white shrink-0 active:scale-95 transition-all"
                        >
                          <LuGamepad2 size={13} className="text-emerald-400" />
                          <span>{t('play.switchGame')}</span>
                        </button>
                      )}

                      <GradientButton
                        size="md"
                        variant="ok"
                        className="shrink-0 min-h-8 text-xs font-bold"
                        loading={isLaunching}
                        onClick={handleLaunchGame}
                      >
                        <IoPlayOutline size={15} aria-hidden />
                        <span>{t('play.launchGame')}</span>
                      </GradientButton>

                      <button
                        type="button"
                        onClick={() => connect(true)}
                        className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-white/10 hover:text-white active:scale-95 transition-all"
                        title="{t('play.directConnect')}"
                      >
                        {t('play.directConnect')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : !isCancelled ? (
              <div className="flex flex-col items-center gap-2">
                {/* Glowing Pulsating Status Text with unified animated ellipsis */}
                <div className="flex items-center gap-1.5 font-mono text-base sm:text-lg font-black tracking-widest text-sky-300 drop-shadow-[0_0_14px_rgba(56,189,248,0.85)]">
                  <span>CONNECTING</span>
                  <span className="inline-flex tracking-normal font-sans">
                    <span style={{ animation: 'dot-glow 1.4s ease-in-out infinite 0s' }}>.</span>
                    <span style={{ animation: 'dot-glow 1.4s ease-in-out infinite 0.25s' }}>.</span>
                    <span style={{ animation: 'dot-glow 1.4s ease-in-out infinite 0.5s' }}>.</span>
                  </span>
                </div>
                <p className="text-xs text-neutral-300/80 font-medium tracking-wide">
                  {t('play.autoConnecting')}
                </p>

                {/* Subdued Cancel Button */}
                <button
                  type="button"
                  onClick={() => {
                    setIsCancelled(true)
                    clearReconnectTimers()
                    setStatus('disconnected')
                  }}
                  className="mt-2 rounded-full border border-white/10 bg-white/5 px-5 py-1.5 text-xs text-neutral-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
                >
                  {t('play.cancelConnect')}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2.5 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex flex-col items-center gap-1">
                  <h2 className="text-base sm:text-lg font-black tracking-widest text-amber-300 font-mono drop-shadow-[0_0_12px_rgba(251,191,36,0.6)] whitespace-nowrap shrink-0">
                    PAUSED
                  </h2>
                  <p className="text-xs text-neutral-400">
                    {t('play.pausedConnecting')}
                  </p>
                </div>

                {/* Prominent Game-style Start Buttons Centered at Bottom */}
                <div className="mt-1 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => connect(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2.5 text-xs sm:text-sm font-bold text-white shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:brightness-110 active:scale-95 transition-all"
                  >
                    <LuRotateCw size={14} />
                    <span>{t('play.reconnect')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setDrawerTab('logs')
                      setDrawerOpen(true)
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-neutral-900/80 px-4 py-2.5 text-xs font-semibold text-neutral-300 shadow-md hover:bg-neutral-800 active:scale-95 transition-all"
                  >
                    <LuScrollText size={14} />
                    <span>{t('play.diagLogs')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. iOS Safari Add to Home Screen Fullscreen Guide Modal */}
      <IosInstallGuideModal
        open={installGuideOpen}
        onClose={() => setInstallGuideOpen(false)}
        isStandalone={isStandalone}
      />

      {/* 6. Centered Remote Modding & Diagnostics Console Modal */}
      <RemoteCheatDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSend={(msg) => linkRef.current?.send(msg)}
        gameId={roomId}
        initialTab={drawerTab}
        status={status}
        latencyMs={latencyMs}
        videoResolution={videoResolution}
        hudVisible={hudVisible}
        onToggleHud={handleToggleHud}
        isPortrait={isPortrait}
      />

      {/* 7. Game Library Selector Modal (Safe for Dynamic Island & Centered header) */}
      {gameSelectorOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-select-title"
          style={{
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
            paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
            paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm select-none"
          onClick={() => setGameSelectorOpen(false)}
        >
          <div
            className={`relative flex flex-col rounded-lg border border-[rgb(230_238_248/0.12)] bg-neutral-900/95 text-neutral-200 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden ${
              isPortrait ? 'w-full max-w-sm max-h-[80vh]' : 'w-full max-w-xl max-h-[85vh]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: Centered title, compressed height, clean icon button */}
            <div className="relative flex items-center justify-center py-1.5 px-8 border-b border-white/10 shrink-0">
              <h3 id="game-select-title" className="text-xs font-bold text-white text-center leading-none">
                {t('play.gameSelectorTitle')}
              </h3>
              <button
                type="button"
                onClick={() => setGameSelectorOpen(false)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-white active:scale-90 transition-all"
                aria-label={t('common.close')}
              >
                <LuX size={15} />
              </button>
            </div>

            {/* List */}
            <div
              className={`flex-1 min-h-0 overflow-y-auto p-3 ${
                isPortrait ? 'space-y-2' : 'grid grid-cols-2 gap-2'
              }`}
            >
              {library.map((item) => {
                const isSelected = selectedGame?.gameRoot === item.gameRoot || selectedGame?.id === item.id
                return (
                  <button
                    key={item.id || item.gameRoot}
                    type="button"
                    onClick={() => handleSelectGame(item)}
                    className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left transition-all active:scale-98 ${
                      isSelected
                        ? 'border-emerald-500/50 bg-emerald-950/40 text-white shadow-sm'
                        : 'border-white/5 bg-white/[0.03] text-neutral-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="text-xs font-semibold truncate">{item.name || 'Untitled Game'}</span>
                      <span className="text-[10px] text-neutral-400 mt-0.5">
                        {item.kindLabel || item.fingerprint?.engine?.name || 'RPG Maker'}
                      </span>
                    </div>
                    {isSelected ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300 shrink-0">
                        <LuCheck size={10} />
                        <span>{t('play.selected')}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-neutral-500 shrink-0">{t('play.tapToSelect')}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {/* 8. Clear Cache & Reload Confirmation Modal (Requirement 6) */}
      {reloadConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reload-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm select-none p-4"
          onClick={() => setReloadConfirmOpen(false)}
        >
          <div
            className="relative flex flex-col w-full max-w-sm rounded-lg border border-[rgb(230_238_248/0.15)] bg-neutral-900/95 p-4 text-neutral-200 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2 text-amber-400">
              <LuRotateCcw size={18} />
              <h3 id="reload-confirm-title" className="text-sm font-bold text-white">
                {t('play.reloadConfirmTitle')}
              </h3>
            </div>
            <p className="text-xs text-neutral-300 leading-relaxed mb-4">
              {t('play.reloadConfirmDesc')}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReloadConfirmOpen(false)}
                className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10 hover:text-white transition-colors"
              >
                {t('common.cancel')}
              </button>
              <GradientButton
                size="md"
                variant="ok"
                onClick={executeHardReload}
              >
                {t('common.confirm')}
              </GradientButton>
            </div>
          </div>
        </div>
      )}

      {/* 9. Quit Game Confirmation Modal (Requirement 7) */}
      {quitConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="quit-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm select-none p-4"
          onClick={() => setQuitConfirmOpen(false)}
        >
          <div
            className="relative flex flex-col w-full max-w-sm rounded-lg border border-rose-500/30 bg-neutral-900/95 p-4 text-neutral-200 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2 text-rose-400">
              <LuPower size={18} />
              <h3 id="quit-confirm-title" className="text-sm font-bold text-white">
                {t('play.quitGameConfirmTitle')}
              </h3>
            </div>
            <p className="text-xs text-neutral-300 leading-relaxed mb-4">
              {t('play.quitGameConfirmDesc')}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setQuitConfirmOpen(false)}
                className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10 hover:text-white transition-colors"
              >
                {t('common.cancel')}
              </button>
              <GradientButton
                size="md"
                variant="fail"
                onClick={executeQuitGame}
              >
                {t('play.quitGame')}
              </GradientButton>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
