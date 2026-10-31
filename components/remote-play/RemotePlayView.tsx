'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'

import type { GameLinkMessage, RemoteInputKey } from '@/lib/runtime/game-link-protocol'
import { WebGameLink } from '@/lib/runtime/web-game-link'

import { FloatingBall } from './FloatingBall'
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
  const [controlsVisible, setControlsVisible] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const linkRef = useRef<WebGameLink | null>(null)
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 1. Resolve room ID if not provided
  useEffect(() => {
    if (initialRoomId) {
      setRoomId(initialRoomId)
      return
    }
    let cancelled = false
    void fetch('/api/status')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const detectedId = data?.resolved?.gameId || data?.config?.gameId || data?.library?.[0]?.gameId || 'default'
        setRoomId(detectedId)
      })
      .catch((err) => {
        if (!cancelled) setErrorMessage(`无法探测游戏房间: ${err instanceof Error ? err.message : String(err)}`)
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
      onConnected: () => {
        if (cancelled) return
        setStatus('connected')
        setErrorMessage(null)
      },
      onDisconnected: () => {
        if (cancelled) return
        setStatus('disconnected')
        setLatencyMs(null)
      },
      onTrack: (stream: MediaStream) => {
        if (cancelled || !videoRef.current) return
        videoRef.current.srcObject = stream
        void videoRef.current.play().catch(() => {
          // Autoplay blocked without user gesture
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
        setStatus((prev) => (prev === 'connected' ? prev : 'disconnected'))
      },
    })

    linkRef.current = link

    void link.start({ enableMedia: true, takeover: true }).catch((err) => {
      if (!cancelled) {
        setStatus('disconnected')
        setErrorMessage(`WebRTC 连接握手异常: ${err instanceof Error ? err.message : String(err)}`)
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

  // 5. Unmute audio on user tap
  const handleUnmute = () => {
    setMuted(false)
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
    } catch {
      /* ignore */
    }
  }

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black select-none">
      {/* Background Video Stream */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        onPointerDown={(e) => handleVideoPointer(e, 'down')}
        onPointerMove={(e) => handleVideoPointer(e, 'move')}
        onPointerUp={(e) => handleVideoPointer(e, 'up')}
        className="h-full w-full object-contain cursor-crosshair touch-none"
        style={{ touchAction: 'none' }}
      />

      {/* Top Floating Control Bar */}
      <header className="pointer-events-none fixed top-0 inset-x-0 z-30 flex items-center justify-between p-3 sm:p-4">
        {/* Status indicator */}
        <div className="pointer-events-auto flex items-center space-x-2 rounded-full border border-white/10 bg-neutral-900/80 px-3.5 py-1.5 text-xs shadow-lg backdrop-blur-md">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              status === 'connected' ? 'bg-emerald-400 animate-pulse' : status === 'connecting' ? 'bg-amber-400 animate-ping' : 'bg-rose-500'
            }`}
          />
          <span className="font-semibold text-neutral-200">{status === 'connected' ? '已串流' : status === 'connecting' ? '连接游戏中…' : '离线'}</span>
          {latencyMs != null && status === 'connected' && <span className="font-mono text-emerald-400 text-[11px]">{latencyMs} ms</span>}
        </div>

        {/* Action icons */}
        <div className="pointer-events-auto flex items-center space-x-2">
          {/* Mute toggle / Unmute button */}
          <button
            type="button"
            onClick={muted ? handleUnmute : () => setMuted(true)}
            className={`flex h-8 items-center rounded-full border px-3 text-xs font-semibold shadow-md backdrop-blur-md transition-colors ${
              muted ? 'border-amber-400/50 bg-amber-950/80 text-amber-200 animate-pulse' : 'border-white/10 bg-neutral-900/80 text-neutral-200 hover:bg-neutral-800'
            }`}
          >
            {muted ? '🔇 点击开声' : '🔊 声音已开'}
          </button>

          {/* Toggle Virtual Controller */}
          <button
            type="button"
            onClick={() => setControlsVisible((prev) => !prev)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-neutral-900/80 text-xs font-bold text-neutral-200 shadow-md backdrop-blur-md hover:bg-neutral-800"
            title="隐藏/显示虚拟按键"
          >
            {controlsVisible ? '🎮' : '🕹️'}
          </button>

          {/* Fullscreen */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-neutral-900/80 text-xs text-neutral-200 shadow-md backdrop-blur-md hover:bg-neutral-800"
            title="全屏"
          >
            ⛶
          </button>
        </div>
      </header>

      {/* Error or Connecting Overlay */}
      {status !== 'connected' && (
        <div className="pointer-events-none fixed inset-0 z-20 flex flex-col items-center justify-center bg-black/75 p-6 text-center backdrop-blur-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-neutral-900 border border-neutral-700 text-3xl shadow-2xl">
            {status === 'connecting' ? '📡' : '🔌'}
          </div>
          <h2 className="mt-4 text-lg font-bold text-white">{status === 'connecting' ? '正在连接电脑端游戏…' : '游戏未就绪或已断开'}</h2>
          <p className="mt-2 max-w-sm text-xs text-neutral-400 leading-relaxed">
            {status === 'connecting'
              ? '请确保电脑上已启动 Chaya 并开启了游戏。WebRTC 内网点对点串流正在建立中…'
              : errorMessage || '未检测到正在运行的游戏。请在电脑端打开控制台启动游戏后刷新重试。'}
          </p>
        </div>
      )}

      {/* Floating Ball for In-Game Mod Drawer */}
      <FloatingBall onClick={() => setDrawerOpen(true)} />

      {/* Virtual D-Pad & Action Buttons */}
      <VirtualController onInput={handleInput} visible={controlsVisible} />

      {/* Remote Modding Drawer */}
      <RemoteCheatDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onSend={(msg) => linkRef.current?.send(msg)} gameId={roomId} />
    </main>
  )
}
