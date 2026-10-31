'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
  LuMaximize2,
  LuMinimize2,
  LuPower,
  LuVolume2,
  LuVolumeX,
  LuX,
} from 'react-icons/lu'

import { Badge, Button, Spinner } from '@/components/sk'
import { WebGameLink } from '@/lib/runtime/web-game-link'
import type { CloudGameInstance } from '@/services/runtime/game-instance-manager'

type Props = {
  instance: CloudGameInstance | null
  open: boolean
  onClose: () => void
  onTerminate: (pid: number) => Promise<void>
}

export function GameObserverModal({ instance, open, onClose, onTerminate }: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [streamReady, setStreamReady] = useState(false)
  const [terminating, setTerminating] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const linkRef = useRef<WebGameLink | null>(null)

  // 建立 WebRTC 画面长连接（直接接收游戏 Canvas 与 WebAudio 轨道，无轮询）
  useEffect(() => {
    if (!open || !instance) {
      setStreamReady(false)
      if (linkRef.current) {
        linkRef.current.stop({ silent: true })
        linkRef.current = null
      }
      return
    }

    setStreamReady(false)
    const obsRoomId = `${instance.roomId}:observer`
    const link = new WebGameLink(obsRoomId, {
      onTrack: (stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
          setStreamReady(true)
        }
      },
    })

    linkRef.current = link
    link.start({ enableMedia: true, takeover: true }).catch(() => {})

    return () => {
      link.stop({ silent: true })
      if (linkRef.current === link) {
        linkRef.current = null
      }
      setStreamReady(false)
    }
  }, [open, instance?.roomId])

  // 监听全屏状态变化同步 UI
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  if (!open || !instance) return null

  const handleTerminate = async () => {
    if (!window.confirm(`确定要终止游戏实例「${instance.gameTitle}」(PID: ${instance.pid}) 吗？`)) {
      return
    }
    try {
      setTerminating(true)
      await onTerminate(instance.pid)
      onClose()
    } finally {
      setTerminating(false)
    }
  }

  const toggleFullscreen = () => {
    const el = frameRef.current
    if (!document.fullscreenElement) {
      el?.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md">
      <div className="relative flex flex-col w-full max-w-4xl max-h-[92vh] overflow-hidden rounded-xl border border-white/10 bg-[#0c1017] shadow-2xl">
        {/* Header: All buttons on top-left with tooltips */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/10 px-3 bg-white/[0.03]">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Top-left icon buttons with tooltips */}
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-7 w-7 text-ink-soft hover:text-ink hover:bg-white/10"
                aria-label="关闭监看" tooltip="关闭监看"
              >
                <LuX size={15} />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={toggleFullscreen}
                className="h-7 w-7 text-ink-soft hover:text-ink hover:bg-white/10"
                aria-label={isFullscreen ? '退出全屏' : '全屏监看'} tooltip={isFullscreen ? '退出全屏' : '全屏监看'}
              >
                {isFullscreen ? <LuMinimize2 size={14} /> : <LuMaximize2 size={14} />}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsMuted((v) => !v)}
                className="h-7 w-7 text-ink-soft hover:text-ink hover:bg-white/10"
                aria-label={isMuted ? '开启声音' : '静音'} tooltip={isMuted ? '开启声音' : '静音'}
              >
                {isMuted ? <LuVolumeX size={14} /> : <LuVolume2 size={14} />}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                disabled={terminating}
                onClick={handleTerminate}
                className="h-7 w-7 text-fail hover:bg-fail/20"
                aria-label="终止游戏实例" tooltip="终止游戏实例"
              >
                <LuPower size={14} />
              </Button>
            </div>

            {/* Game Info */}
            <h2 className="text-xs font-semibold text-ink truncate m-0 ml-1.5" title={instance.gameTitle}>
              {instance.gameTitle}
            </h2>
            <Badge tone="neutral" size="mini" className="font-mono">
              PID: {instance.pid}
            </Badge>
            {instance.webConnected ? (
              <Badge tone="ok" size="mini">
                玩家在线
              </Badge>
            ) : (
              <Badge tone="warn" size="mini">
                闲置 {instance.idleSeconds}s
              </Badge>
            )}
            <Badge tone="info" size="mini">
              {instance.clientIp || '本机'}
            </Badge>
          </div>
        </div>

        {/* Viewport Frame (WebRTC Long Connection Video Stream) */}
        <div
          ref={frameRef}
          id="observer-viewport-frame"
          className="relative flex flex-1 items-center justify-center min-h-[300px] sm:min-h-[460px] bg-black overflow-hidden [&:fullscreen]:w-screen [&:fullscreen]:h-screen [&:fullscreen]:bg-black [&:fullscreen_video]:w-screen [&:fullscreen_video]:h-screen [&:fullscreen_video]:object-contain"
        >
          {/* Direct WebRTC Video Feed */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isMuted}
            className="h-full w-full object-contain select-none pointer-events-none"
          />

          {/* Negotiating / Connecting overlay */}
          {!streamReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 gap-2.5">
              <Spinner size="md" />
              <span className="text-xs text-ink-soft font-mono">正在连接 WebRTC 串流画面...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
