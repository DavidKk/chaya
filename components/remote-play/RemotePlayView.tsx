'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  LuActivity,
  LuCompass,
  LuGamepad2,
  LuMaximize2,
  LuMinimize2,
  LuMousePointer2,
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
  type: 'connected' | 'disconnected' | 'connecting'
  text: string
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

  // Unified Menu Modal (Single Button trigger, Requirement 4)
  const [menuOpen, setMenuOpen] = useState(false)

  // Control Mode: fixed, touch, dynamic (Requirement 2)
  const [controlMode, setControlMode] = useState<ControlMode>('fixed')

  // Auto-reconnect & toast states
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const [autoReconnectCountdown, setAutoReconnectCountdown] = useState<number | null>(null)
  const [statusToast, setStatusToast] = useState<StatusToast | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const linkRef = useRef<WebGameLink | null>(null)
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatusRef = useRef(status)

  const resetIdleTimer = useCallback(() => {
    setIsIdle(false)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      setIsIdle(true)
    }, 2800)
  }, [])

  const showStatusToast = useCallback(
    (type: 'connected' | 'disconnected' | 'connecting', text: string, durationMs = 2800) => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
      setStatusToast({ type, text })
      toastTimeoutRef.current = setTimeout(() => {
        setStatusToast(null)
      }, durationMs)
    },
    []
  )

  const clearReconnectTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    setAutoReconnectCountdown(null)
  }, [])

  // 0. Environment diagnostics, orientation detection & saved preferences
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
      } catch {
        /* ignore */
      }
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
        showStatusToast('disconnected', '串流已断开，正在自动重连…', 3200)
      } else if (status === 'connecting' && prev === 'disconnected') {
        showStatusToast('connecting', '正在重新连接…', 2200)
      }
    }
  }, [status, showStatusToast])

  // 2. Resolve room ID if not provided
  useEffect(() => {
    if (initialRoomId) {
      remotePlayLogger.info(`使用指定游戏房间: ${initialRoomId}`)
      setRoomId(initialRoomId)
      return
    }
    let cancelled = false
    remotePlayLogger.info('正在请求 /api/status 探测可用游戏房间…')
    void fetch('/api/status')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const selected = data?.selected
        const selectedGame =
          data?.library?.find((item: { gameRoot?: string; id?: string }) => item.gameRoot === selected) ||
          data?.library?.[0]
        const detectedId =
          selectedGame?.id ||
          data?.config?.library?.[0]?.id ||
          data?.library?.[0]?.id ||
          data?.resolved?.gameId ||
          'default'
        remotePlayLogger.ok(`探测到游戏房间: ${detectedId}`, {
          gameId: detectedId,
          selected,
          name: selectedGame?.name,
        })
        setRoomId(detectedId)
      })
      .catch((err) => {
        const msg = `无法探测游戏房间: ${err instanceof Error ? err.message : String(err)}`
        remotePlayLogger.fail(msg)
        if (!cancelled) setErrorMessage(msg)
      })
    return () => {
      cancelled = true
    }
  }, [initialRoomId])

  // 3. WebRTC Link Connection & Auto-reconnect
  const connect = useCallback(
    (isManual = false) => {
      if (!roomId) return
      clearReconnectTimers()

      setStatus('connecting')
      setErrorMessage(null)

      if (isManual) {
        remotePlayLogger.info('用户手动点击重新连接游戏串流')
      } else {
        remotePlayLogger.info(`正在建立 WebRTC 串流连接 (房间: ${roomId})`)
      }

      linkRef.current?.stop()

      const scheduleAutoReconnect = () => {
        clearReconnectTimers()
        let countdown = 3
        setAutoReconnectCountdown(countdown)

        countdownTimerRef.current = setInterval(() => {
          countdown -= 1
          if (countdown > 0) {
            setAutoReconnectCountdown(countdown)
          } else {
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
            setAutoReconnectCountdown(null)
          }
        }, 1000)

        reconnectTimerRef.current = setTimeout(() => {
          setReconnectAttempt((prev) => prev + 1)
          remotePlayLogger.info('开始执行 WebRTC 自动重连…')
          connect(false)
        }, 3000)
      }

      const link = new WebGameLink(roomId, {
        onLog: (level, msg, meta) => {
          remotePlayLogger.add(level, msg, meta)
        },
        onConnected: () => {
          clearReconnectTimers()
          setReconnectAttempt(0)
          setStatus('connected')
          remotePlayLogger.ok('云游戏 WebRTC 链路握手成功，已建立端到端连接')
          setErrorMessage(null)
        },
        onDisconnected: () => {
          setStatus('disconnected')
          setLatencyMs(null)
          remotePlayLogger.warn('云游戏 WebRTC 链路断开，已进入自动重连')
          scheduleAutoReconnect()
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
          remotePlayLogger.warn('信令等待游戏端响应超时或未就绪，准备重试')
          setStatus((prev) => (prev === 'connected' ? prev : 'disconnected'))
          scheduleAutoReconnect()
        },
      })

      linkRef.current = link

      void link.start({ enableMedia: true, takeover: true }).catch((err) => {
        const errStr = `WebRTC 连接握手异常: ${err instanceof Error ? err.message : String(err)}`
        remotePlayLogger.fail(errStr)
        setStatus('disconnected')
        setErrorMessage(errStr)
        scheduleAutoReconnect()
      })
    },
    [roomId, clearReconnectTimers]
  )

  useEffect(() => {
    if (!roomId) return
    connect(false)

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
  }, [roomId, connect, clearReconnectTimers])

  // 4. Remote input dispatch
  const handleInput = useCallback((key: RemoteInputKey, action: 'down' | 'up') => {
    linkRef.current?.send({
      type: 'remote.input',
      key,
      action,
    })
  }, [])

  // 5. Direct canvas touch on video (active in touch mode and canvas taps)
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

  // 6. Unmute audio on user tap
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

            {/* Performance HUD in Top-Left (Requirement 6) */}
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

            {/* ONLY ONE Menu Button in Top-Right (Requirement 4) */}
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
        /* Landscape Layout: Fullscreen video with ONE single menu button (Requirements 3 & 4) */
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
              {/* Performance HUD in Top-Left (Requirement 6) */}
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

              {/* ONLY ONE Single Menu Button in Top-Right (Requirement 4) */}
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

              {/* Virtual D-Pad & Action Buttons (Configurable via mode, Requirements 2 & 5) */}
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

      {/* 3. Unified Control Menu Modal (Requirement 4: 唯一的弹出入口) */}
      {menuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="menu-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm select-none"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/15 bg-neutral-900/95 p-4 sm:p-5 text-neutral-200 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-md">
                  <LuSlidersHorizontal size={14} />
                </div>
                <h3 id="menu-title" className="text-sm font-bold text-white whitespace-nowrap shrink-0">
                  Chaya 串流控制台
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
                aria-label="关闭"
              >
                <LuX size={15} />
              </button>
            </div>

            {/* Section 1: 操作模式选择 (Requirement 2) */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                操作模式
              </div>
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-neutral-950/70 border border-white/5">
                {/* Mode 1: 固定手柄 */}
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

                {/* Mode 2: 屏幕触摸 */}
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

                {/* Mode 3: 自由摇杆 */}
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

              {/* Mode description hint */}
              <div className="text-[10px] text-neutral-400 px-1 leading-normal">
                {controlMode === 'fixed' && '固定手柄：左下角固定虚拟摇杆，右侧动作按键。'}
                {controlMode === 'touch' && '屏幕触摸：隐藏所有虚拟按键，触屏点击作为鼠标/触控操作。'}
                {controlMode === 'dynamic' && '自由摇杆：在左半屏任意处触屏下压，即刻在该位置生成摇杆。'}
              </div>
            </div>

            {/* Section 2: 核心功能与居中控制台入口 (Requirements 3 & 4) */}
            <div className="space-y-1.5 pt-1">
              <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                功能与设置
              </div>

              <div className="space-y-1 text-xs">
                {/* 常用修改 (居中控制台) */}
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

                {/* 诊断日志 */}
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

                {/* 声音开关 */}
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

                {/* 画面比例 */}
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

                {/* 性能 HUD 开关 */}
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

                {/* 全屏模式 (仅非 standalone 时展示) */}
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
        </div>
      )}

      {/* 4. Error or Connecting Overlay */}
      {status !== 'connected' && (
        <div className="pointer-events-auto fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-6 text-center backdrop-blur-md select-none">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-white/10 bg-neutral-900/80 p-3 shadow-2xl backdrop-blur-md">
            <img
              src="/brand/chaya-mark.svg"
              alt="Chaya Logo"
              className={`h-14 w-14 object-contain ${
                status === 'connecting'
                  ? 'animate-pulse drop-shadow-[0_0_12px_rgba(42,212,255,0.45)]'
                  : 'opacity-85'
              }`}
            />
            {status === 'connecting' && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-sky-500" />
              </span>
            )}
          </div>

          <h2 className="mt-4 text-base sm:text-lg font-bold text-white whitespace-nowrap shrink-0">
            {status === 'connecting' ? '正在连接电脑端游戏…' : '游戏未就绪或连接断开'}
          </h2>

          <p className="mt-2 max-w-sm text-xs text-neutral-400 leading-relaxed">
            {status === 'connecting'
              ? '请确保电脑上已启动 Chaya 并开启了游戏。WebRTC 内网点对点串流正在建立中…'
              : errorMessage || '未检测到正在运行的游戏。请在电脑端开启游戏。'}
          </p>

          {status === 'disconnected' && autoReconnectCountdown != null && (
            <div className="mt-3 flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-950/40 px-3 py-1 text-[11px] text-sky-300 whitespace-nowrap shrink-0">
              <LuRotateCw size={12} className="animate-spin text-sky-400 shrink-0" />
              <span className="whitespace-nowrap shrink-0">
                将在 {autoReconnectCountdown} 秒后自动重试{reconnectAttempt > 0 ? ` (第 ${reconnectAttempt} 次)` : ''}…
              </span>
            </div>
          )}

          <div className="mt-5 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => connect(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-600/80 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-md hover:bg-emerald-500 active:scale-95 whitespace-nowrap shrink-0 transition-all"
            >
              <LuRotateCw size={13} className={status === 'connecting' ? 'animate-spin' : ''} />
              <span className="whitespace-nowrap shrink-0">
                {status === 'connecting' ? '连接中…' : '立即重连'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDrawerTab('logs')
                setDrawerOpen(true)
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-neutral-800/80 px-3.5 py-2 text-xs font-semibold text-neutral-300 shadow-lg backdrop-blur-md hover:bg-neutral-700 active:scale-95 whitespace-nowrap shrink-0 transition-all"
            >
              <LuScrollText size={13} />
              <span className="whitespace-nowrap shrink-0">诊断日志</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. iOS Safari Add to Home Screen Fullscreen Guide Modal */}
      <IosInstallGuideModal
        open={installGuideOpen}
        onClose={() => setInstallGuideOpen(false)}
        isStandalone={isStandalone}
      />

      {/* 6. Centered Remote Modding & Diagnostics Console Modal (Requirement 3: 居中不走侧栏) */}
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
      />
    </main>
  )
}
