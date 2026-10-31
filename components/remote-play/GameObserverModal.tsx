'use client'

import React, { useEffect, useState } from 'react'
import {
  LuClock,
  LuExternalLink,
  LuMaximize2,
  LuMinimize2,
  LuPlay,
  LuPower,
  LuRefreshCw,
  LuSmartphone,
  LuTv,
  LuX,
} from 'react-icons/lu'

import { Badge, Button } from '@/components/sk'
import type { CloudGameInstance } from '@/services/runtime/game-instance-manager'

type Props = {
  instance: CloudGameInstance | null
  open: boolean
  onClose: () => void
  onTerminate: (pid: number) => Promise<void>
}

export function GameObserverModal({ instance, open, onClose, onTerminate }: Props) {
  const [refreshKey, setRefreshKey] = useState(Date.now())
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [terminating, setTerminating] = useState(false)

  // 监看弹窗打开时，每 3 秒自动拉取最新游戏画面快照
  useEffect(() => {
    if (!open || !instance || !autoRefresh) return
    const timer = setInterval(() => {
      setRefreshKey(Date.now())
    }, 3000)
    return () => clearInterval(timer)
  }, [open, instance, autoRefresh])

  if (!open || !instance) return null

  const handleManualRefresh = () => {
    setRefreshKey(Date.now())
  }

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
    const el = document.getElementById('observer-viewport-frame')
    if (!document.fullscreenElement) {
      el?.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  const playUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}${instance.streamUrl}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-md">
      <div className="relative flex flex-col w-full max-w-4xl max-h-[92vh] overflow-hidden rounded-xl border border-white/10 bg-[#0c1017] shadow-2xl">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-4 bg-white/[0.02]">
          <div className="flex items-center gap-2.5 min-w-0">
            <LuTv size={17} className="text-emerald-400 shrink-0" />
            <h2 className="text-sm font-semibold text-ink truncate m-0">{instance.gameTitle}</h2>
            <Badge tone="neutral" className="text-[0.68rem] font-mono px-1.5 py-0">
              PID: {instance.pid}
            </Badge>
            {instance.webConnected ? (
              <Badge tone="ok" className="flex items-center gap-1 text-[0.68rem] px-1.5 py-0">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                玩家已连接
              </Badge>
            ) : (
              <Badge tone="warn" className="text-[0.68rem] px-1.5 py-0">
                闲置中 ({instance.idleSeconds}s)
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="md"
              onClick={handleManualRefresh}
              className="h-7 px-2 text-xs text-ink-soft hover:text-ink gap-1"
              title="手动抓取最新画面"
            >
              <LuRefreshCw size={13} className="shrink-0" />
              <span className="hidden sm:inline">刷新快照</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="h-7 w-7 text-ink-soft hover:text-ink"
              title={isFullscreen ? '退出全屏' : '全屏监看'}
            >
              {isFullscreen ? <LuMinimize2 size={14} /> : <LuMaximize2 size={14} />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-7 w-7 text-ink-soft hover:text-ink"
              title="关闭"
            >
              <LuX size={16} />
            </Button>
          </div>
        </div>

        {/* Notice banner */}
        <div className="flex items-center justify-between bg-emerald-950/30 border-b border-emerald-500/20 px-4 py-1.5 text-xs text-emerald-300">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-medium">只读监看模式</span>
            <span className="text-emerald-400/70 hidden sm:inline">— 不包含任何控制按键与输入捕获，绝不干扰玩家游玩</span>
          </div>
          <label className="flex items-center gap-1.5 text-[0.72rem] text-emerald-300/80 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-white/20 bg-black/40 text-emerald-500 focus:ring-0"
            />
            自动刷新 (3s)
          </label>
        </div>

        {/* Viewport Frame */}
        <div
          id="observer-viewport-frame"
          className="relative flex flex-1 items-center justify-center min-h-[280px] sm:min-h-[420px] bg-black overflow-hidden"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={refreshKey}
            src={`${instance.screenshotUrl}&t=${refreshKey}`}
            alt={instance.gameTitle}
            className="max-h-full max-w-full object-contain select-none"
          />

          <div className="absolute bottom-2 left-2 pointer-events-none rounded bg-black/70 px-2 py-0.5 text-[0.68rem] text-white/70 font-mono backdrop-blur-sm border border-white/10">
            {new Date(refreshKey).toLocaleTimeString()} · 实时画面
          </div>
        </div>

        {/* Footer / Telemetry */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-2.5 bg-white/[0.015] text-xs">
          <div className="flex items-center gap-3 text-ink-soft">
            <span className="flex items-center gap-1">
              <LuSmartphone size={13} />
              {instance.clientIp ? `设备: ${instance.clientIp}` : '无外部设备'}
            </span>
            <span className="flex items-center gap-1">
              <LuClock size={13} />
              {instance.webConnected
                ? '玩家正在游玩'
                : `闲置 ${instance.idleSeconds}s (将在 ${instance.remainingIdleSeconds}s 后自动清理)`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="md"
              onClick={() => {
                navigator.clipboard.writeText(playUrl)
                alert('已复制手机端游玩连接到剪贴板！')
              }}
              className="h-7 text-xs gap-1"
            >
              <LuExternalLink size={12} />
              复制游玩地址
            </Button>
            <Button
              variant="fail"
              size="md"
              disabled={terminating}
              onClick={handleTerminate}
              className="h-7 text-xs gap-1 bg-rose-600/80 hover:bg-rose-600 text-white border-0"
            >
              <LuPower size={12} />
              结束实例
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
