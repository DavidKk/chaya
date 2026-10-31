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

  // Control Mode: fixed, touch, dynamic
  const [controlMode, setControlMode] = useState<ControlMode>('fixed')

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

  const handleClearCacheAndReload = useCallback(async () => {
    remotePlayLogger.info('用户触发清理缓存并重载页面')
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
    remotePlayLogger.info('远程游玩视图已挂载')
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
        showStatusToast('connected', '已连接游戏串流')
      } else if (status === 'disconnected') {
        if (gameOnline) {
          showStatusToast('disconnected', '串流已断开，正在自动重连…', 3000)
        }
      } else if (status === 'connecting' && prev === 'disconnected') {
        showStatusToast('connecting', '正在重新连接…', 2000)
      }
    }
  }, [status, gameOnline, showStatusToast])

  // 2. Resolve room ID, game library & check if game is online
  useEffect(() => {
    let cancelled = false
    remotePlayLogger.info('正在请求 /api/status 探测可用游戏与运行状态…')
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

        remotePlayLogger.ok(`探测到游戏房间与状态: ${detectedId} (在线: ${isOnline})`, {
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
        const msg = `无法获取游戏状态: ${err instanceof Error ? err.message : String(err)}`
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
        remotePlayLogger.info('用户手动重连游戏串流')
      } else {
        remotePlayLogger.info(`正在建立 WebRTC 串流连接 (房间: ${roomId})`)
      }

      linkRef.current?.stop()

      const scheduleSilentAutoReconnect = () => {
        clearReconnectTimers()
        reconnectTimerRef.current = setTimeout(() => {
          remotePlayLogger.info('自动重新发起 WebRTC 串流连接…')
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
          remotePlayLogger.ok('云游戏 WebRTC 链路握手成功，已建立端到端连接')
          setErrorMessage(null)
        },
        onDisconnected: () => {
          setStatus('disconnected')
          setLatencyMs(null)
          remotePlayLogger.warn('云游戏 WebRTC 链路断开，自动静默重连中')
          scheduleSilentAutoReconnect()
        },
        onTrack: (stream: MediaStream) => {
          streamRef.current = stream
          remotePlayLogger.ok(`接收到远程媒体流，包含 ${stream.getTracks().length} 个音视频轨道`, {
            tracks: stream.getTracks().map((t) => ({ kind: t.kind, label: t.label, readyState: t.readyState })),
          })
          if (!videoRef.current) return
          if (videoRef.current.srcObject !== stream) {
            videoRef.current.srcObject = stream
          }
          void videoRef.current
            .play()
            .then(() => {
              remotePlayLogger.ok('视频画面已开始播放')
            })
            .catch((err) => {
              remotePlayLogger.warn(
                `视频自动播放被浏览器拦截（需要用户轻触屏幕以唤醒播放）: ${
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
          remotePlayLogger.warn('信令等待游戏端响应中，自动重试')
          setStatus((prev) => (prev === 'connected' ? prev : 'disconnected'))
          scheduleSilentAutoReconnect()
        },
      })

      linkRef.current = link

      void link.start({ enableMedia: true, takeover: true }).catch((err) => {
        const errStr = `WebRTC 连接握手异常: ${err instanceof Error ? err.message : String(err)}`
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
    remotePlayLogger.info('用户在手机端点击启动游戏，发起 POST /api/launch…')
    showStatusToast('connecting', '正在启动游戏进程…', 8000)

    try {
      const res = await fetch('/api/launch', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.ok === false) {
        const errMsg = data?.error?.message || data?.error || '启动游戏失败'
        remotePlayLogger.fail(`启动游戏异常: ${errMsg}`)
        showStatusToast('disconnected', `启动失败: ${errMsg}`, 4000)
        setIsLaunching(false)
        return
      }

      remotePlayLogger.ok('游戏进程已拉起，等待 WebRTC 串流就绪…')
      showStatusToast('connecting', '游戏已拉起，等待就绪…', 6000)

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
            remotePlayLogger.ok('检测到游戏已在线，自动连入 WebRTC 串流')
            connect(true)
            return
          }
        } catch {
          /* ignore */
        }

        if (attempts >= maxAttempts) {
          clearInterval(pollInterval)
          setIsLaunching(false)
          remotePlayLogger.warn('等待游戏上线超时，进入重连待命状态')
          showStatusToast('disconnected', '游戏启动较慢，可点击下方重连', 4000)
        }
      }, 1200)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      remotePlayLogger.fail(`启动请求发生异常: ${errMsg}`)
      showStatusToast('disconnected', `请求失败: ${errMsg}`, 4000)
      setIsLaunching(false)
    }
  }, [isLaunching, showStatusToast, connect])

  // Game switching handler
  const handleSelectGame = useCallback(
    async (game: LibraryItem) => {
      remotePlayLogger.info(`切换目标游戏至: ${game.name} (${game.gameRoot})`)
      try {
        const res = await fetch('/api/status', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameRoot: game.gameRoot }),
        })
        const data = await res.json()
        if (!res.ok || data.ok === false) {
          showStatusToast('disconnected', '切换游戏失败', 3000)
          return
        }
        setSelectedGame(game)
        setRoomId(game.id)
        setGameSelectorOpen(false)
        showStatusToast('info', `已切换至: ${game.name}`, 2500)

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
        showStatusToast('disconnected', '网络异常，切换游戏失败', 3000)
      }
    },
    [showStatusToast, connect]
  )

  // 4. Remote input dispatch
  const handleInput = useCallback((key: RemoteInputKey, action: 'down' | 'up') => {
    linkRef.current?.send({
      type: 'remote.input',
      key,
      action,
    })
  }, [])

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
      remotePlayLogger.info('用户轻触屏幕尝试唤醒视频播放')
      void videoRef.current.play().catch(() => {})
    }
  }

  // 7. Unmute audio on user tap
  const handleUnmute = () => {
    setMuted(false)
    remotePlayLogger.info('用户点击开启声音')
    if (videoRef.current) {
      videoRef.current.muted = false
      void videoRef.current.play().catch(() => {})
    }
  }

  const toggleFullscreen = () => {
    resetIdleTimer()

    if (isStandalone) {
      setInstallGuideOpen(true)
      remotePlayLogger.info('检测到已处于主屏独立全屏模式 (Web App)')
      return
    }

    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> }
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {})
      } else if (doc.webkitExitFullscreen) {
        void doc.webkitExitFullscreen().catch(() => {})
      }
      remotePlayLogger.info('用户退出全屏模式')
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
      remotePlayLogger.info('触发 iOS Safari 添加到主屏幕全屏指引')
      return
    }

    if (docEl.requestFullscreen) {
      docEl
        .requestFullscreen()
        .then(() => {
          remotePlayLogger.ok('已成功进入网页全屏')
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
      remotePlayLogger.info(`切换画面比例模式: ${next === 'cover' ? '铺满全屏' : '等比适应'}`)
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
    const names = {
      fixed: '固定手柄模式',
      touch: '屏幕触摸模式 (鼠标模式)',
      dynamic: '自由摇杆模式',
    }
    showStatusToast('connecting', `已切换至: ${names[mode]}`, 2000)
    remotePlayLogger.info(`操作模式切换为: ${names[mode]}`)
  }

  const effectiveIdle = isIdle && status === 'connected' && !drawerOpen && !menuOpen

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
                title="打开设置与控制台"
                aria-label="打开设置与控制台"
              >
                <LuSlidersHorizontal size={14} className="text-emerald-400" />
              </button>
            )}
          </div>

          {/* Dedicated Gamepad Area in Portrait */}
          {status === 'connected' && (
            <div className="flex-1 w-full relative">
              <VirtualController
                onInput={handleInput}
                visible={true}
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

              {/* ONLY ONE Single Menu Button in Top-Right */}
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                style={{
                  top: 'max(0.5rem, env(safe-area-inset-top))',
                  right: 'max(0.75rem, env(safe-area-inset-right))',
                }}
                className={`pointer-events-auto fixed z-40 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-neutral-900/85 text-neutral-300 shadow-xl backdrop-blur-md transition-all duration-300 hover:bg-neutral-800 active:scale-95 shrink-0 ${
                  effectiveIdle ? 'opacity-35 hover:opacity-100' : 'opacity-90 hover:opacity-100'
                }`}
                title="打开快捷设置与控制台"
                aria-label="打开快捷设置与控制台"
              >
                <LuSlidersHorizontal size={15} className="text-emerald-400" />
              </button>

              {/* Virtual D-Pad & Action Buttons */}
              <VirtualController
                onInput={handleInput}
                visible={true}
                idle={effectiveIdle}
                isPortrait={false}
                mode={controlMode}
              />
            </>
          )}
        </>
      )}

      {/* 3. Unified Control Menu Modal */}
      {menuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="menu-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm select-none"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className={`relative flex flex-col rounded-2xl border border-white/15 bg-neutral-900/95 text-neutral-200 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden ${
              isPortrait
                ? 'w-[92vw] max-w-sm max-h-[85vh]'
                : 'w-[94vw] max-w-2xl'
            }`}
            style={{
              maxHeight: isPortrait ? '85vh' : 'min(380px, 88vh)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header (Compact) */}
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-1.5">
                <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-sm">
                  <LuSlidersHorizontal size={12} />
                </div>
                <h3 id="menu-title" className="text-xs sm:text-sm font-bold text-white whitespace-nowrap shrink-0">
                  串流控制台
                </h3>
                <span className="text-[9px] text-neutral-400 px-1.5 py-0.5 rounded bg-white/5 border border-white/5 shrink-0">
                  {isPortrait ? '竖屏' : '横屏'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
                aria-label="关闭"
              >
                <LuX size={13} />
              </button>
            </div>

            {/* Scrollable Content Body */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {isPortrait ? (
                /* === 竖屏布局：单列纵向排列 === */
                <div className="space-y-4">
                  {/* Section 1: 操作模式选择 */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                      操作模式
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-neutral-950/70 border border-white/5">
                      <button
                        type="button"
                        onClick={() => handleSelectControlMode('fixed')}
                        className={`flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-xs transition-all ${
                          controlMode === 'fixed'
                            ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 font-bold shadow-sm'
                            : 'text-neutral-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <LuGamepad2 size={16} />
                        <span className="text-[11px] whitespace-nowrap">固定手柄</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectControlMode('touch')}
                        className={`flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-xs transition-all ${
                          controlMode === 'touch'
                            ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 font-bold shadow-sm'
                            : 'text-neutral-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <LuMousePointer2 size={16} />
                        <span className="text-[11px] whitespace-nowrap">屏幕触摸</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSelectControlMode('dynamic')}
                        className={`flex flex-col items-center justify-center gap-1 rounded-lg py-2 px-1 text-xs transition-all ${
                          controlMode === 'dynamic'
                            ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 font-bold shadow-sm'
                            : 'text-neutral-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        <LuCompass size={16} />
                        <span className="text-[11px] whitespace-nowrap">自由摇杆</span>
                      </button>
                    </div>

                    <div className="text-[10px] text-neutral-400 px-1 leading-normal">
                      {controlMode === 'fixed' && '固定手柄：左下角固定虚拟摇杆，右侧动作按键。'}
                      {controlMode === 'touch' && '屏幕触摸：隐藏所有虚拟按键，触屏点击作为鼠标/触控操作。'}
                      {controlMode === 'dynamic' && '自由摇杆：在左半屏任意处触屏下压，即刻在该位置生成摇杆。'}
                    </div>
                  </div>

                  {/* Section 2: 核心功能与设置 */}
                  <div className="space-y-1.5 pt-1">
                    <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                      功能与设置
                    </div>

                    <div className="space-y-1 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setDrawerTab('cheat')
                          setDrawerOpen(true)
                          setMenuOpen(false)
                        }}
                        className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <LuSparkles size={15} className="text-amber-400 shrink-0" />
                          <span className="whitespace-nowrap shrink-0">局内控制台 (常用修改)</span>
                        </span>
                        <span className="text-[10px] text-neutral-400">打开</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setDrawerTab('logs')
                          setDrawerOpen(true)
                          setMenuOpen(false)
                        }}
                        className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <LuScrollText size={15} className="text-sky-400 shrink-0" />
                          <span className="whitespace-nowrap shrink-0">运行与诊断日志</span>
                        </span>
                        <span className="text-[10px] text-neutral-400">查看</span>
                      </button>

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
                          <span className="whitespace-nowrap shrink-0">游戏声音输出</span>
                        </span>
                        <span className={`text-[10px] font-semibold ${muted ? 'text-amber-300' : 'text-emerald-400'}`}>
                          {muted ? '已静音 (点击开声)' : '已开启'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={toggleFitMode}
                        className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <LuScaling size={15} className="text-sky-400 shrink-0" />
                          <span className="whitespace-nowrap shrink-0">画面缩放模式</span>
                        </span>
                        <span className="text-[10px] text-sky-300 font-mono">
                          {fitMode === 'cover' ? '铺满全屏' : '等比适应'}
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
                          <span className="whitespace-nowrap shrink-0">实时性能 HUD (FPS / 延迟)</span>
                        </span>
                        <span className={`text-[10px] ${hudVisible ? 'text-emerald-400' : 'text-neutral-500'}`}>
                          {hudVisible ? '已显示' : '已隐藏'}
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
                            <span className="whitespace-nowrap shrink-0">全屏显示</span>
                          </span>
                          <span className="text-[10px] text-neutral-400">
                            {isFullscreen ? '退出全屏' : 'iOS添加主屏幕'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* === 横屏布局：游戏式双列横向扩展 (Landscape 2-Column Game Menu) === */
                <div className="grid grid-cols-2 gap-4 items-start">
                  {/* Left Column: 操作模式与快捷入口 */}
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                        操作模式
                      </div>
                      <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-neutral-950/70 border border-white/5">
                        <button
                          type="button"
                          onClick={() => handleSelectControlMode('fixed')}
                          className={`flex flex-col items-center justify-center gap-1 rounded-lg py-1.5 px-1 text-xs transition-all ${
                            controlMode === 'fixed'
                              ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 font-bold shadow-sm'
                              : 'text-neutral-400 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <LuGamepad2 size={15} />
                          <span className="text-[10px] whitespace-nowrap">固定手柄</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSelectControlMode('touch')}
                          className={`flex flex-col items-center justify-center gap-1 rounded-lg py-1.5 px-1 text-xs transition-all ${
                            controlMode === 'touch'
                              ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 font-bold shadow-sm'
                              : 'text-neutral-400 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <LuMousePointer2 size={15} />
                          <span className="text-[10px] whitespace-nowrap">屏幕触摸</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSelectControlMode('dynamic')}
                          className={`flex flex-col items-center justify-center gap-1 rounded-lg py-1.5 px-1 text-xs transition-all ${
                            controlMode === 'dynamic'
                              ? 'bg-emerald-950/80 border border-emerald-400/50 text-emerald-300 font-bold shadow-sm'
                              : 'text-neutral-400 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <LuCompass size={15} />
                          <span className="text-[10px] whitespace-nowrap">自由摇杆</span>
                        </button>
                      </div>

                      <div className="text-[10px] text-neutral-400 px-1 leading-normal">
                        {controlMode === 'fixed' && '固定手柄：左下角固定虚拟摇杆，右侧动作按键。'}
                        {controlMode === 'touch' && '屏幕触摸：隐藏所有虚拟按键，触屏点击作为鼠标/触控操作。'}
                        {controlMode === 'dynamic' && '自由摇杆：在左半屏任意处触屏下压，即刻在该位置生成摇杆。'}
                      </div>
                    </div>

                    {/* Quick Modding & Diagnostic Drawer Entrances */}
                    <div className="space-y-1.5 pt-1">
                      <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                        快捷面板
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setDrawerTab('cheat')
                            setDrawerOpen(true)
                            setMenuOpen(false)
                          }}
                          className="flex flex-col items-center justify-center gap-1 rounded-xl border border-white/5 bg-white/[0.03] p-2 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
                        >
                          <LuSparkles size={16} className="text-amber-400 shrink-0" />
                          <span className="font-semibold text-[11px] whitespace-nowrap">局内控制台</span>
                          <span className="text-[9px] text-neutral-400">常用修改功能</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setDrawerTab('logs')
                            setDrawerOpen(true)
                            setMenuOpen(false)
                          }}
                          className="flex flex-col items-center justify-center gap-1 rounded-xl border border-white/5 bg-white/[0.03] p-2 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
                        >
                          <LuScrollText size={16} className="text-sky-400 shrink-0" />
                          <span className="font-semibold text-[11px] whitespace-nowrap">诊断日志</span>
                          <span className="text-[9px] text-neutral-400">运行网络排查</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: 音画与系统设置 */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                      音画与系统
                    </div>

                    <div className="space-y-1.5 text-xs">
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
                          <span className="whitespace-nowrap shrink-0">声音输出</span>
                        </span>
                        <span className={`text-[10px] font-semibold ${muted ? 'text-amber-300' : 'text-emerald-400'}`}>
                          {muted ? '已静音 (点击开声)' : '已开启'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={toggleFitMode}
                        className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <LuScaling size={15} className="text-sky-400 shrink-0" />
                          <span className="whitespace-nowrap shrink-0">画面缩放</span>
                        </span>
                        <span className="text-[10px] text-sky-300 font-mono">
                          {fitMode === 'cover' ? '铺满全屏' : '等比适应'}
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
                          <span className="whitespace-nowrap shrink-0">实时 HUD</span>
                        </span>
                        <span className={`text-[10px] ${hudVisible ? 'text-emerald-400' : 'text-neutral-500'}`}>
                          {hudVisible ? '已显示' : '已隐藏'}
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
                            <span className="whitespace-nowrap shrink-0">全屏显示</span>
                          </span>
                          <span className="text-[10px] text-neutral-400">
                            {isFullscreen ? '退出全屏' : 'iOS添加主屏幕'}
                          </span>
                        </button>
                      )}

                      {/* Game Switch Entry */}
                      {library.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setGameSelectorOpen(true)
                            setMenuOpen(false)
                          }}
                          className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            <LuGamepad2 size={15} className="text-emerald-400 shrink-0" />
                            <span className="whitespace-nowrap shrink-0">切换游戏</span>
                          </span>
                          <span className="text-[10px] text-neutral-400 truncate max-w-[120px]">
                            {selectedGame?.name || '选择游戏'}
                          </span>
                        </button>
                      )}

                      {/* Clear Cache & Hard Reload Entry */}
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false)
                          void handleClearCacheAndReload()
                        }}
                        className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-neutral-200 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <LuRotateCcw size={15} className="text-amber-400 shrink-0" />
                          <span className="whitespace-nowrap shrink-0">清理缓存并重载</span>
                        </span>
                        <span className="text-[10px] text-neutral-400">重置偏好并刷新</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
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

          {/* Top Bar with Safe Area: Top-Right Clear Cache & Hard Reload Button */}
          <div
            style={{
              top: 'max(0.75rem, env(safe-area-inset-top))',
              right: 'max(0.75rem, env(safe-area-inset-right))',
            }}
            className="pointer-events-auto fixed z-50 flex items-center gap-2"
          >
            <button
              type="button"
              onClick={handleClearCacheAndReload}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-neutral-900/80 px-3 py-1.5 text-xs text-neutral-300 hover:text-white hover:bg-neutral-800 backdrop-blur-md active:scale-95 transition-all shadow-md"
              title="清理本地所有缓存并硬刷新页面"
            >
              <LuRotateCcw size={12} className="text-sky-400" />
              <span>清理重载</span>
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
                  正在拉起本地游戏进程并准备 WebRTC 串流…
                </p>
              </div>
            ) : gameOnline === false ? (
              <div className="flex flex-col items-center gap-3 w-full max-w-sm animate-in fade-in zoom-in-95 duration-200">
                {/* Current Game Card */}
                <div className="flex items-center justify-between w-full rounded-2xl border border-white/15 bg-neutral-900/85 px-4 py-2.5 backdrop-blur-md shadow-xl">
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="text-[10px] text-neutral-400 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      <span>游戏未运行 · 待拉起</span>
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-white truncate">
                      {selectedGame?.name || 'RPG Maker 游戏'}
                    </span>
                  </div>

                  {library.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setGameSelectorOpen(true)}
                      className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-neutral-300 hover:bg-white/10 hover:text-white shrink-0 active:scale-95 transition-all"
                    >
                      <LuGamepad2 size={13} className="text-emerald-400" />
                      <span>切换游戏</span>
                    </button>
                  )}
                </div>

                {/* Prominent Launch CTA Button */}
                <button
                  type="button"
                  onClick={handleLaunchGame}
                  className="inline-flex items-center justify-center gap-2 w-full rounded-full border border-emerald-400/50 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 py-3 text-sm font-black text-white shadow-[0_0_24px_rgba(16,185,129,0.5)] hover:brightness-110 active:scale-95 transition-all"
                >
                  <LuPlay size={15} className="fill-white" />
                  <span>启动游戏并连入串流</span>
                </button>

                <div className="flex items-center justify-center gap-4 text-xs pt-0.5">
                  <button
                    type="button"
                    onClick={() => connect(true)}
                    className="text-neutral-400 hover:text-neutral-200 text-[11px] underline underline-offset-2 transition-colors"
                  >
                    直接尝试连接
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
                    诊断日志
                  </button>
                </div>
              </div>
            ) : !isCancelled ? (
              <div className="flex flex-col items-center gap-2">
                {/* Glowing Pulsating Status Text */}
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-black tracking-widest text-sky-300 font-mono animate-pulse drop-shadow-[0_0_14px_rgba(56,189,248,0.85)] whitespace-nowrap shrink-0">
                    CONNECTING
                  </h2>
                  <span className="flex space-x-1 items-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
                <p className="text-xs text-neutral-300/80 font-medium tracking-wide">
                  正在自动建立游戏串流通道…
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
                  取消连接
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2.5 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex flex-col items-center gap-1">
                  <h2 className="text-base sm:text-lg font-black tracking-widest text-amber-300 font-mono drop-shadow-[0_0_12px_rgba(251,191,36,0.6)] whitespace-nowrap shrink-0">
                    PAUSED
                  </h2>
                  <p className="text-xs text-neutral-400">
                    已暂停自动连接。点击下方按钮开始连接
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
                    <span>重新连接游戏</span>
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
                    <span>诊断日志</span>
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

      {/* 7. Game Library Selector Modal */}
      {gameSelectorOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-select-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm select-none"
          onClick={() => setGameSelectorOpen(false)}
        >
          <div
            className="relative flex flex-col rounded-2xl border border-white/15 bg-neutral-900/95 text-neutral-200 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden w-[92vw] max-w-sm max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header (Compact) */}
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-1.5">
                <div className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-sm">
                  <LuGamepad2 size={12} />
                </div>
                <h3 id="game-select-title" className="text-xs sm:text-sm font-bold text-white whitespace-nowrap shrink-0">
                  可运行游戏列表
                </h3>
                <span className="text-[9px] text-neutral-400 px-1.5 py-0.5 rounded bg-white/5 border border-white/5 shrink-0">
                  {library.length} 款
                </span>
              </div>
              <button
                type="button"
                onClick={() => setGameSelectorOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
                aria-label="关闭"
              >
                <LuX size={13} />
              </button>
            </div>

            {/* List */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
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
                      <span className="text-xs font-semibold truncate">{item.name || '未命名游戏'}</span>
                      <span className="text-[10px] text-neutral-400 mt-0.5">
                        {item.kindLabel || item.fingerprint?.engine?.name || 'RPG Maker'}
                      </span>
                    </div>
                    {isSelected ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300 shrink-0">
                        <LuCheck size={10} />
                        <span>当前选中</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-neutral-500 shrink-0">点击选择</span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Footer */}
            <div className="border-t border-neutral-800 px-3 py-2 text-center text-[10px] text-neutral-400 shrink-0">
              选择目标游戏后，可在手机端一键拉起本地运行并串流
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
