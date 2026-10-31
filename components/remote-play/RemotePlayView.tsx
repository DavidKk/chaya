'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { LuActivity, LuGamepad2, LuMaximize2, LuRadio, LuRotateCw, LuScrollText, LuUnplug, LuVolume2, LuVolumeX } from 'react-icons/lu'

import type { GameLinkMessage, RemoteInputKey } from '@/lib/runtime/game-link-protocol'
import { initErudaMobileDevTools } from '@/lib/runtime/mobile-devtools'
import { remotePlayLogger } from '@/lib/runtime/remote-play-logger'
import { WebGameLink } from '@/lib/runtime/web-game-link'

import { FloatingBall } from './FloatingBall'
import { PerformanceHud } from './PerformanceHud'
import { RemoteCheatDrawer } from './RemoteCheatDrawer'
import { VirtualController } from './VirtualController'

type RemotePlayViewProps = {
  initialRoomId?: string
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

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const linkRef = useRef<WebGameLink | null>(null)
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetIdleTimer = useCallback(() => {
    setIsIdle(false)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      setIsIdle(true)
    }, 2800)
  }, [])

  // 0. Environment & error diagnostic collector
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

    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search)
      if (q.get('debug') === '1' || q.get('eruda') === '1' || localStorage.getItem('chaya_remote_play_devtools') === '1') {
        void initErudaMobileDevTools()
      }
      if (localStorage.getItem('chaya_remote_play_hud') === '1') {
        setHudVisible(true)
      }
    }
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      window.removeEventListener('pointerdown', handleActivity)
      window.removeEventListener('pointermove', handleActivity)
      window.removeEventListener('keydown', handleActivity)
    }
  }, [resetIdleTimer])

  // 1. Resolve room ID if not provided
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
        const selectedGame = data?.library?.find((item: { gameRoot?: string; id?: string }) => item.gameRoot === selected) || data?.library?.[0]
        const detectedId = selectedGame?.id || data?.config?.library?.[0]?.id || data?.library?.[0]?.id || data?.resolved?.gameId || 'default'
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

  // 2. Start WebRTC link with enableMedia
  useEffect(() => {
    if (!roomId) return

    let cancelled = false
    setStatus('connecting')

    const link = new WebGameLink(roomId, {
      onLog: (level, msg, meta) => {
        remotePlayLogger.add(level, msg, meta)
      },
      onConnected: () => {
        if (cancelled) return
        setStatus('connected')
        remotePlayLogger.ok('云游戏 WebRTC 链路握手成功，已建立端到端连接')
        setErrorMessage(null)
      },
      onDisconnected: () => {
        if (cancelled) return
        setStatus('disconnected')
        setLatencyMs(null)
        remotePlayLogger.warn('云游戏 WebRTC 链路断开')
      },
      onTrack: (stream: MediaStream) => {
        streamRef.current = stream
        remotePlayLogger.ok(`接收到远程媒体流，包含 ${stream.getTracks().length} 个音视频轨道`, {
          tracks: stream.getTracks().map((t) => ({ kind: t.kind, label: t.label, readyState: t.readyState })),
        })
        if (cancelled || !videoRef.current) return
        if (videoRef.current.srcObject !== stream) {
          videoRef.current.srcObject = stream
        }
        void videoRef.current.play()
          .then(() => {
            remotePlayLogger.ok('视频画面已开始播放')
          })
          .catch((err) => {
            remotePlayLogger.warn(`视频自动播放被浏览器拦截（需要用户轻触屏幕以唤醒播放）: ${err instanceof Error ? err.message : String(err)}`)
          })
      },
      onMessage: (msg: GameLinkMessage) => {
        if (msg.type === 'pong') {
          const rtt = Date.now() - msg.t
          setLatencyMs(Math.max(1, Math.round(rtt / 2)))
        }
      },
      onIdle: () => {
        if (cancelled) return
        remotePlayLogger.warn('信令等待游戏端响应超时或已被其他标签页占用')
        setStatus((prev) => (prev === 'connected' ? prev : 'disconnected'))
      },
    })

    linkRef.current = link

    remotePlayLogger.info(`正在建立 WebRTC 串流连接 (房间: ${roomId})`)
    void link.start({ enableMedia: true, takeover: true }).catch((err) => {
      if (!cancelled) {
        const errStr = `WebRTC 连接握手异常: ${err instanceof Error ? err.message : String(err)}`
        remotePlayLogger.fail(errStr)
        setStatus('disconnected')
        setErrorMessage(errStr)
      }
    })

    // Keepalive ping & latency probe
    pingTimerRef.current = setInterval(() => {
      if (link.connected) {
        link.send({ type: 'ping', t: Date.now() })
      }
    }, 2500)

    return () => {
      cancelled = true
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      link.stop()
      linkRef.current = null
    }
  }, [roomId])

  // 3. Remote input dispatch
  const handleInput = useCallback((key: RemoteInputKey, action: 'down' | 'up') => {
    linkRef.current?.send({
      type: 'remote.input',
      key,
      action,
    })
  }, [])

  // 4. Direct canvas touch on video
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

  // 5. Unmute audio on user tap
  const handleUnmute = () => {
    setMuted(false)
    remotePlayLogger.info('用户点击开启声音')
    if (videoRef.current) {
      videoRef.current.muted = false
      void videoRef.current.play().catch(() => {})
    }
  }

  const toggleFullscreen = () => {
    try {
      if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen?.()
      } else {
        void document.exitFullscreen?.()
      }
      remotePlayLogger.info('用户切换全屏状态')
    } catch {
      /* ignore */
    }
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
      className="relative h-screen w-screen overflow-hidden bg-black select-none"
    >
      {/* Background Video Stream */}
      <video
        ref={setVideoRef}
        autoPlay
        playsInline
        muted={muted}
        onLoadedMetadata={() => {
          const v = videoRef.current
          if (v && (v.videoWidth || v.videoHeight)) {
            setVideoResolution({ width: v.videoWidth, height: v.videoHeight })
            remotePlayLogger.ok(`视频流尺寸就绪: ${v.videoWidth} × ${v.videoHeight}`, {
              videoWidth: v.videoWidth,
              videoHeight: v.videoHeight,
            })
          }
        }}
        onWaiting={() => {
          remotePlayLogger.warn('视频流发生网络缓冲等待 (onWaiting)')
        }}
        onError={() => {
          const v = videoRef.current
          remotePlayLogger.fail(`视频播放器错误: ${v?.error?.message || 'MediaError'} (code: ${v?.error?.code})`, {
            code: v?.error?.code,
            message: v?.error?.message,
          })
        }}
        onPointerDown={(e) => handleVideoPointer(e, 'down')}
        onPointerMove={(e) => handleVideoPointer(e, 'move')}
        onPointerUp={(e) => handleVideoPointer(e, 'up')}
        className="h-full w-full object-contain cursor-crosshair touch-none"
        style={{ touchAction: 'none' }}
      />

      {/* Top Floating Control Bar */}
      <header
        className={`pointer-events-none fixed top-0 inset-x-0 z-30 flex items-center justify-between p-2 sm:p-3 transition-opacity duration-300 ${
          effectiveIdle ? 'opacity-25 hover:opacity-100' : 'opacity-100'
        }`}
      >
        {/* Status indicator */}
        <div
          onClick={() => {
            setDrawerTab('logs')
            setDrawerOpen(true)
          }}
          className="pointer-events-auto flex items-center space-x-1.5 rounded-full border border-white/10 bg-neutral-900/80 px-2.5 py-1 text-[11px] shadow-lg backdrop-blur-md cursor-pointer hover:bg-neutral-800/90 transition-colors"
          title="点击查看连接与诊断日志"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              status === 'connected' ? 'bg-emerald-400 animate-pulse' : status === 'connecting' ? 'bg-amber-400 animate-ping' : 'bg-rose-500'
            }`}
          />
          <span className="font-semibold text-neutral-200">{status === 'connected' ? '已串流' : status === 'connecting' ? '连接中…' : '离线'}</span>
          {latencyMs != null && status === 'connected' && <span className="font-mono text-emerald-400 text-[10px]">{latencyMs} ms</span>}
        </div>

        {/* Action icons */}
        <div className="pointer-events-auto flex items-center space-x-1.5">
          {/* Mute toggle / Unmute button */}
          <button
            type="button"
            onClick={muted ? handleUnmute : () => setMuted(true)}
            className={`flex h-7 items-center rounded-full border px-2 text-[11px] font-semibold shadow-md backdrop-blur-md transition-colors ${
              muted ? 'border-amber-400/50 bg-amber-950/80 text-amber-200 animate-pulse' : 'border-white/10 bg-neutral-900/80 text-neutral-200 hover:bg-neutral-800'
            }`}
          >
            {muted ? <LuVolumeX size={13} className="mr-1" /> : <LuVolume2 size={13} className="mr-1 text-emerald-400" />}
            {muted ? '开声' : '已开'}
          </button>

          {/* Toggle Virtual Controller */}
          <button
            type="button"
            onClick={() => setControlsVisible((prev) => !prev)}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-neutral-900/80 text-xs font-bold text-neutral-200 shadow-md backdrop-blur-md hover:bg-neutral-800"
            title="隐藏/显示虚拟手柄"
            aria-label="隐藏/显示虚拟手柄"
          >
            <LuGamepad2 size={14} className={controlsVisible ? 'text-emerald-400' : 'text-neutral-400'} />
          </button>

          {/* Performance HUD toggle */}
          <button
            type="button"
            onClick={handleToggleHud}
            className={`flex h-7 w-7 items-center justify-center rounded-full border shadow-md backdrop-blur-md transition-colors ${
              hudVisible
                ? 'border-emerald-400/50 bg-emerald-950/80 text-emerald-300'
                : 'border-white/10 bg-neutral-900/80 text-neutral-400 hover:text-white hover:bg-neutral-800'
            }`}
            title="性能 HUD 监控 (FPS/延迟)"
            aria-label="性能 HUD 监控"
          >
            <LuActivity size={14} />
          </button>

          {/* Log / Diagnostics button */}
          <button
            type="button"
            onClick={() => {
              setDrawerTab('logs')
              setDrawerOpen(true)
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-neutral-900/80 text-xs text-sky-400 shadow-md backdrop-blur-md hover:bg-neutral-800"
            title="运行与诊断日志"
            aria-label="运行与诊断日志"
          >
            <LuScrollText size={14} />
          </button>

          {/* Fullscreen */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-neutral-900/80 text-xs text-neutral-200 shadow-md backdrop-blur-md hover:bg-neutral-800"
            title="全屏切换"
            aria-label="全屏切换"
          >
            <LuMaximize2 size={14} />
          </button>
        </div>
      </header>

      {/* Floating Performance HUD */}
      <PerformanceHud
        visible={hudVisible}
        idle={effectiveIdle}
        latencyMs={latencyMs}
        videoResolution={videoResolution}
        status={status}
        muted={muted}
        onClose={() => setHudVisible(false)}
      />

      {/* Error or Connecting Overlay */}
      {status !== 'connected' && (
        <div className="pointer-events-none fixed inset-0 z-20 flex flex-col items-center justify-center bg-black/75 p-6 text-center backdrop-blur-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-900 border border-neutral-700 shadow-2xl">
            {status === 'connecting' ? <LuRadio size={32} className="text-amber-400 animate-pulse" /> : <LuUnplug size={32} className="text-rose-400" />}
          </div>
          <h2 className="mt-4 text-lg font-bold text-white">{status === 'connecting' ? '正在连接电脑端游戏…' : '游戏未就绪或已断开'}</h2>
          <p className="mt-2 max-w-sm text-xs text-neutral-400 leading-relaxed">
            {status === 'connecting'
              ? '请确保电脑上已启动 Chaya 并开启了游戏。WebRTC 内网点对点串流正在建立中…'
              : errorMessage || '未检测到正在运行的游戏。请在电脑端打开控制台启动游戏后刷新重试。'}
          </p>
          <button
            type="button"
            onClick={() => {
              if (!roomId) return
              setStatus('connecting')
              setErrorMessage(null)
              remotePlayLogger.info('用户点击重新连接 WebRTC 游戏串流')
              linkRef.current?.stop()
              const link = new WebGameLink(roomId, {
                onLog: (level, msg, meta) => remotePlayLogger.add(level, msg, meta),
                onConnected: () => {
                  setStatus('connected')
                  remotePlayLogger.ok('重连成功，WebRTC 链路已连接')
                },
                onDisconnected: () => {
                  setStatus('disconnected')
                  setLatencyMs(null)
                  remotePlayLogger.warn('WebRTC 链路断开')
                },
                onTrack: (stream) => {
                  streamRef.current = stream
                  if (videoRef.current && videoRef.current.srcObject !== stream) {
                    videoRef.current.srcObject = stream
                    void videoRef.current.play().catch(() => {})
                  }
                },
                onIdle: () => setStatus((p) => p === 'connected' ? p : 'disconnected'),
              })
              linkRef.current = link
              void link.start({ enableMedia: true, takeover: true }).catch((err) => {
                setStatus('disconnected')
                const errStr = `重连异常: ${err instanceof Error ? err.message : String(err)}`
                remotePlayLogger.fail(errStr)
                setErrorMessage(errStr)
              })
            }}
            className="pointer-events-auto mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-neutral-800/90 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-md hover:bg-neutral-700 active:scale-95"
          >
            <LuRotateCw size={13} className={status === 'connecting' ? 'animate-spin' : ''} />
            {status === 'connecting' ? '正在连接…' : '重新连接'}
          </button>
          <button
            type="button"
            onClick={() => {
              setDrawerTab('logs')
              setDrawerOpen(true)
            }}
            className="pointer-events-auto mt-3 inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-950/70 px-4 py-2 text-xs font-semibold text-sky-200 shadow-lg backdrop-blur-md hover:bg-sky-900 active:scale-95"
          >
            <LuScrollText size={13} />
            查看诊断日志
          </button>
        </div>
      )}

      {/* Floating Ball for In-Game Mod Drawer */}
      <FloatingBall
        idle={effectiveIdle}
        onClick={() => {
          setDrawerTab('cheat')
          setDrawerOpen(true)
        }}
      />

      {/* Virtual D-Pad & Action Buttons */}
      <VirtualController onInput={handleInput} visible={controlsVisible} idle={effectiveIdle} />

      {/* Remote Modding Drawer */}
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
