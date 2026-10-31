'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  LuActivity,
  LuGamepad2,
  LuMaximize2,
  LuMenu,
  LuMinimize2,
  LuRotateCw,
  LuScaling,
  LuScrollText,
  LuSparkles,
  LuVolume2,
  LuVolumeX,
} from 'react-icons/lu'

import type { GameLinkMessage, RemoteInputKey } from '@/lib/runtime/game-link-protocol'
import { initErudaMobileDevTools } from '@/lib/runtime/mobile-devtools'
import { remotePlayLogger } from '@/lib/runtime/remote-play-logger'
import { WebGameLink } from '@/lib/runtime/web-game-link'

import { FloatingBall } from './FloatingBall'
import { IosInstallGuideModal } from './IosInstallGuideModal'
import { PerformanceHud } from './PerformanceHud'
import { RemoteCheatDrawer } from './RemoteCheatDrawer'
import { VirtualController } from './VirtualController'

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
  const [controlsVisible, setControlsVisible] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [installGuideOpen, setInstallGuideOpen] = useState(false)
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain')
  const [isPortrait, setIsPortrait] = useState(false)
  const [landscapeMenuOpen, setLandscapeMenuOpen] = useState(false)

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

  // 0. Environment diagnostics & orientation detection
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

  // 1. Toast notifications on connection status changes (Requirement 7)
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

  // 3. WebRTC Link Connection & Auto-reconnect (Requirement 1)
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

    // Keepalive ping & latency probe
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
    if (landscapeMenuOpen) {
      setLandscapeMenuOpen(false)
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

    // If running as iOS Web Clip / PWA standalone, it already equals fullscreen
    if (isStandalone) {
      setInstallGuideOpen(true)
      remotePlayLogger.info('检测到已处于主屏独立全屏模式 (Web App)')
      return
    }

    // If in standard full screen, exit
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

    // Check device and browser capabilities
    const docEl = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>
    }
    const isIos =
      typeof navigator !== 'undefined' &&
      (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

    // On iOS Safari (or browsers without fullscreen API), prompt to Add to Home Screen
    if (isIos || (!docEl.requestFullscreen && !docEl.webkitRequestFullscreen)) {
      setInstallGuideOpen(true)
      remotePlayLogger.info('触发 iOS Safari 添加到主屏幕全屏指引')
      return
    }

    // Standard fullscreen API
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

  const effectiveIdle = isIdle && status === 'connected' && !drawerOpen

  return (
    <main
      onPointerDown={handleGlobalPointerDown}
      className="relative h-screen w-screen overflow-hidden bg-black select-none touch-none"
    >
      {/* 1. Status Change Toast (Requirement 7: simple toast, not permanent) */}
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
        /* Portrait Layout: Video at top, controls neatly below (Requirements 3 & 4) */
        <div className="flex h-full w-full flex-col">
          {/* Top Video Container */}
          <div
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
            className="relative w-full aspect-video max-h-[44vh] bg-neutral-950 flex items-center justify-center overflow-hidden shrink-0 border-b border-white/10"
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
          </div>

          {/* Middle Toolbar in Portrait (Only when connected, Requirement 8) */}
          {status === 'connected' && (
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 bg-neutral-900/80 backdrop-blur-md shrink-0">
              <div className="flex items-center gap-1.5">
                {/* Audio Button */}
                <button
                  type="button"
                  onClick={muted ? handleUnmute : () => setMuted(true)}
                  className={`flex h-7 items-center rounded-full border px-2 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    muted
                      ? 'border-amber-400/50 bg-amber-950/80 text-amber-200 animate-pulse'
                      : 'border-white/10 bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
                  }`}
                >
                  {muted ? (
                    <LuVolumeX size={12} className="mr-1 shrink-0" />
                  ) : (
                    <LuVolume2 size={12} className="mr-1 text-emerald-400 shrink-0" />
                  )}
                  <span className="whitespace-nowrap shrink-0">{muted ? '开声' : '已开'}</span>
                </button>

                {/* Fit Mode Button */}
                <button
                  type="button"
                  onClick={toggleFitMode}
                  className={`flex h-7 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors whitespace-nowrap shrink-0 ${
                    fitMode === 'cover'
                      ? 'border-sky-400/50 bg-sky-950/80 text-sky-300'
                      : 'border-white/10 bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                  }`}
                  title="画面比例切换"
                >
                  <LuScaling size={12} className="shrink-0" />
                  <span className="whitespace-nowrap shrink-0">{fitMode === 'cover' ? '铺满' : '等比'}</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                {/* Controller Toggle */}
                <button
                  type="button"
                  onClick={() => setControlsVisible((p) => !p)}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors shrink-0 ${
                    controlsVisible
                      ? 'border-emerald-400/40 bg-emerald-950/70 text-emerald-300'
                      : 'border-white/10 bg-neutral-800 text-neutral-400'
                  }`}
                  title="手柄显隐"
                  aria-label="手柄显隐"
                >
                  <LuGamepad2 size={13} />
                </button>

                {/* HUD Toggle */}
                <button
                  type="button"
                  onClick={handleToggleHud}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors shrink-0 ${
                    hudVisible
                      ? 'border-emerald-400/40 bg-emerald-950/70 text-emerald-300'
                      : 'border-white/10 bg-neutral-800 text-neutral-400'
                  }`}
                  title="性能 HUD"
                  aria-label="性能 HUD"
                >
                  <LuActivity size={13} />
                </button>

                {/* Cheat Drawer */}
                <button
                  type="button"
                  onClick={() => {
                    setDrawerTab('cheat')
                    setDrawerOpen(true)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-amber-400/30 bg-amber-950/50 text-amber-300 hover:bg-amber-900/60 transition-colors shrink-0"
                  title="金手指修改器"
                  aria-label="金手指修改器"
                >
                  <LuSparkles size={13} />
                </button>

                {/* Logs Drawer */}
                <button
                  type="button"
                  onClick={() => {
                    setDrawerTab('logs')
                    setDrawerOpen(true)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-neutral-800 text-sky-400 hover:bg-neutral-700 transition-colors shrink-0"
                  title="诊断日志"
                  aria-label="诊断日志"
                >
                  <LuScrollText size={13} />
                </button>

                {/* Fullscreen (only if !isStandalone, Requirement 10) */}
                {!isStandalone && (
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors shrink-0 ${
                      isFullscreen
                        ? 'border-emerald-400/40 bg-emerald-950/70 text-emerald-300'
                        : 'border-white/10 bg-neutral-800 text-neutral-200'
                    }`}
                    title="全屏切换"
                    aria-label="全屏切换"
                  >
                    {isFullscreen ? <LuMinimize2 size={13} /> : <LuMaximize2 size={13} />}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bottom Gamepad Area in Portrait (Only when connected, Requirement 8) */}
          {status === 'connected' && (
            <div className="flex-1 w-full relative">
              <VirtualController
                onInput={handleInput}
                visible={controlsVisible}
                idle={effectiveIdle}
                isPortrait={true}
              />
            </div>
          )}
        </div>
      ) : (
        /* Landscape Layout: Fullscreen video with compact top controls (Requirements 3, 4, 5) */
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

          {/* In-game UI (Only when connected, Requirement 8) */}
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

              {/* Landscape Top-Right Controls: Sound & Collapsible Menu (Requirement 3) */}
              <header
                style={{
                  top: 'max(0.5rem, env(safe-area-inset-top))',
                  right: 'max(0.75rem, env(safe-area-inset-right))',
                }}
                className={`pointer-events-auto fixed z-40 flex items-center gap-2 select-none transition-opacity duration-300 ${
                  effectiveIdle ? 'opacity-25 hover:opacity-100' : 'opacity-100'
                }`}
              >
                {/* Quick Sound button (Requirement 2: whitespace-nowrap) */}
                <button
                  type="button"
                  onClick={muted ? handleUnmute : () => setMuted(true)}
                  className={`flex h-7 items-center rounded-full border px-2 text-[11px] font-semibold shadow-md backdrop-blur-md transition-colors whitespace-nowrap shrink-0 ${
                    muted
                      ? 'border-amber-400/50 bg-amber-950/80 text-amber-200 animate-pulse'
                      : 'border-white/10 bg-neutral-900/80 text-neutral-200 hover:bg-neutral-800'
                  }`}
                >
                  {muted ? (
                    <LuVolumeX size={13} className="mr-1 shrink-0" />
                  ) : (
                    <LuVolume2 size={13} className="mr-1 text-emerald-400 shrink-0" />
                  )}
                  <span className="whitespace-nowrap shrink-0">{muted ? '开声' : '已开'}</span>
                </button>

                {/* Collapsible Menu Button (Requirement 3: 菜单收到一个菜单按键里面) */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setLandscapeMenuOpen((prev) => !prev)
                    }}
                    className={`flex h-7 w-7 items-center justify-center rounded-full border shadow-md backdrop-blur-md transition-colors shrink-0 ${
                      landscapeMenuOpen
                        ? 'border-emerald-400/50 bg-emerald-950/80 text-emerald-300'
                        : 'border-white/10 bg-neutral-900/80 text-neutral-300 hover:bg-neutral-800'
                    }`}
                    title="功能菜单"
                    aria-label="功能菜单"
                  >
                    <LuMenu size={15} />
                  </button>

                  {/* Glassmorphic Dropdown Popover */}
                  {landscapeMenuOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-8.5 z-50 w-44 rounded-2xl border border-white/15 bg-neutral-900/95 p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 space-y-1 select-none"
                    >
                      {/* Fit Mode Toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          toggleFitMode()
                          setLandscapeMenuOpen(false)
                        }}
                        className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0"
                      >
                        <span className="flex items-center gap-2">
                          <LuScaling size={14} className="text-sky-400 shrink-0" />
                          <span className="whitespace-nowrap shrink-0">画面比例</span>
                        </span>
                        <span className="text-[10px] text-neutral-400 font-mono whitespace-nowrap shrink-0">
                          {fitMode === 'cover' ? '铺满' : '等比'}
                        </span>
                      </button>

                      {/* Gamepad Visibility */}
                      <button
                        type="button"
                        onClick={() => {
                          setControlsVisible((p) => !p)
                          setLandscapeMenuOpen(false)
                        }}
                        className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0"
                      >
                        <span className="flex items-center gap-2">
                          <LuGamepad2
                            size={14}
                            className={controlsVisible ? 'text-emerald-400 shrink-0' : 'text-neutral-500 shrink-0'}
                          />
                          <span className="whitespace-nowrap shrink-0">虚拟手柄</span>
                        </span>
                        <span className="text-[10px] text-neutral-400 whitespace-nowrap shrink-0">
                          {controlsVisible ? '显示' : '隐藏'}
                        </span>
                      </button>

                      {/* HUD Toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          handleToggleHud()
                          setLandscapeMenuOpen(false)
                        }}
                        className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0"
                      >
                        <span className="flex items-center gap-2">
                          <LuActivity
                            size={14}
                            className={hudVisible ? 'text-emerald-400 shrink-0' : 'text-neutral-500 shrink-0'}
                          />
                          <span className="whitespace-nowrap shrink-0">性能 HUD</span>
                        </span>
                        <span className="text-[10px] text-neutral-400 whitespace-nowrap shrink-0">
                          {hudVisible ? '开启' : '关闭'}
                        </span>
                      </button>

                      {/* Cheat Mod Drawer */}
                      <button
                        type="button"
                        onClick={() => {
                          setDrawerTab('cheat')
                          setDrawerOpen(true)
                          setLandscapeMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0"
                      >
                        <LuSparkles size={14} className="text-amber-400 shrink-0" />
                        <span className="whitespace-nowrap shrink-0">金手指修改器</span>
                      </button>

                      {/* Diagnostics Log */}
                      <button
                        type="button"
                        onClick={() => {
                          setDrawerTab('logs')
                          setDrawerOpen(true)
                          setLandscapeMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0"
                      >
                        <LuScrollText size={14} className="text-sky-400 shrink-0" />
                        <span className="whitespace-nowrap shrink-0">运行诊断日志</span>
                      </button>

                      {/* Fullscreen (only if !isStandalone, Requirement 10) */}
                      {!isStandalone && (
                        <button
                          type="button"
                          onClick={() => {
                            toggleFullscreen()
                            setLandscapeMenuOpen(false)
                          }}
                          className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 border-t border-white/5 pt-1.5"
                        >
                          <span className="flex items-center gap-2">
                            {isFullscreen ? (
                              <LuMinimize2 size={14} className="text-emerald-400 shrink-0" />
                            ) : (
                              <LuMaximize2 size={14} className="text-neutral-300 shrink-0" />
                            )}
                            <span className="whitespace-nowrap shrink-0">
                              {isFullscreen ? '退出全屏' : '全屏模式'}
                            </span>
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </header>

              {/* Floating Ball for Mod Drawer (Requirement 5: avoids Dynamic Island band) */}
              <FloatingBall
                idle={effectiveIdle}
                onClick={() => {
                  setDrawerTab('cheat')
                  setDrawerOpen(true)
                }}
              />

              {/* Virtual D-Pad & Action Buttons (scaled for landscape, Requirements 4 & 5) */}
              <VirtualController
                onInput={handleInput}
                visible={controlsVisible}
                idle={effectiveIdle}
                isPortrait={false}
              />
            </>
          )}
        </>
      )}

      {/* 3. Error or Connecting Overlay (Requirements 1, 8, 9: Uses Logo, Auto-reconnect) */}
      {status !== 'connected' && (
        <div className="pointer-events-auto fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-6 text-center backdrop-blur-md select-none">
          {/* Chaya Brand Logo (Requirement 9: 使用 Logo 不用链接 ICON) */}
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

          {/* Auto-reconnect countdown badge (Requirement 1) */}
          {status === 'disconnected' && autoReconnectCountdown != null && (
            <div className="mt-3 flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-950/40 px-3 py-1 text-[11px] text-sky-300 whitespace-nowrap shrink-0">
              <LuRotateCw size={12} className="animate-spin text-sky-400 shrink-0" />
              <span className="whitespace-nowrap shrink-0">
                将在 {autoReconnectCountdown} 秒后自动重试{reconnectAttempt > 0 ? ` (第 ${reconnectAttempt} 次)` : ''}…
              </span>
            </div>
          )}

          {/* Action buttons (Requirement 2: whitespace-nowrap) */}
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

      {/* 4. iOS Safari Add to Home Screen Fullscreen Guide Modal */}
      <IosInstallGuideModal
        open={installGuideOpen}
        onClose={() => setInstallGuideOpen(false)}
        isStandalone={isStandalone}
      />

      {/* 5. Remote Modding Drawer */}
      <RemoteCheatDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSend={(msg) => linkRef.current?.send(msg)}
        gameId={roomId}
        initialTab={drawerTab}
      />
    </main>
  )
}
