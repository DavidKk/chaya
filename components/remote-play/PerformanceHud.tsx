'use client'

import React, { useEffect, useRef, useState } from 'react'
import { LuActivity, LuChevronRight, LuX } from 'react-icons/lu'

type PerformanceHudProps = {
  visible: boolean
  idle?: boolean
  isStandalone?: boolean
  latencyMs?: number | null
  videoResolution?: { width: number; height: number } | null
  status: 'connecting' | 'connected' | 'disconnected'
  muted: boolean
  onClose?: () => void
}

export function PerformanceHud({
  visible,
  idle = false,
  isStandalone = false,
  latencyMs,
  videoResolution,
  status,
  muted,
  onClose,
}: PerformanceHudProps) {
  const [fps, setFps] = useState<number>(60)
  const [expanded, setExpanded] = useState<boolean>(false)
  const frameCountRef = useRef(0)
  const lastTimeRef = useRef(performance.now())
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!visible) return
    let active = true

    const loop = (time: number) => {
      if (!active) return
      frameCountRef.current += 1
      if (time - lastTimeRef.current >= 1000) {
        const currentFps = Math.round((frameCountRef.current * 1000) / (time - lastTimeRef.current))
        setFps(Math.min(120, currentFps))
        frameCountRef.current = 0
        lastTimeRef.current = time
      }
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      active = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [visible])

  if (!visible) return null

  const latencyColor =
    latencyMs == null
      ? 'text-neutral-400'
      : latencyMs < 35
      ? 'text-emerald-400'
      : latencyMs < 80
      ? 'text-amber-400'
      : 'text-rose-400'

  const fpsColor = fps >= 55 ? 'text-emerald-400' : fps >= 30 ? 'text-amber-400' : 'text-rose-400'

  return (
    <div
      style={{
        left: "max(0.625rem, env(safe-area-inset-left))",
        top: "max(0.5rem, env(safe-area-inset-top))",
      }}
      className={`pointer-events-auto fixed z-40 select-none transition-all duration-300 ${
        idle && !expanded ? 'opacity-35 hover:opacity-100 active:opacity-100' : 'opacity-85 hover:opacity-100 active:opacity-100'
      }`}
    >
      {!expanded ? (
        /* Compact Mode: Small, subtle, semi-transparent chip */
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="group flex items-center gap-1.5 rounded-lg border border-white/10 bg-neutral-950/60 px-2 py-0.5 font-mono text-[10px] text-neutral-300 shadow-md backdrop-blur-md transition-colors hover:bg-neutral-900/90 hover:border-white/20 whitespace-nowrap shrink-0"
          title="点击展开实时性能监控 (FPS / 延迟 / 分辨率)"
        >
          <span className={`${fpsColor} font-semibold whitespace-nowrap shrink-0`}>
            {fps} <span className="text-[9px] text-neutral-400 font-sans">FPS</span>
          </span>
          <span className="text-white/20">·</span>
          <span className={`${latencyColor} whitespace-nowrap shrink-0`}>
            {latencyMs != null ? `${latencyMs}ms` : '--'}
          </span>
          <LuChevronRight size={10} className="text-neutral-500 group-hover:text-white transition-colors shrink-0" />
        </button>
      ) : (
        /* Expanded Mode: Full stats panel */
        <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-neutral-950/90 px-2.5 py-1 font-mono text-[11px] text-neutral-300 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 whitespace-nowrap shrink-0">
          <div className="flex items-center gap-1 text-neutral-400 font-sans whitespace-nowrap shrink-0">
            <LuActivity size={12} className="text-emerald-400 shrink-0" />
            <span className="font-semibold text-neutral-200">HUD</span>
          </div>

          <span className="h-3 w-[1px] bg-white/10 shrink-0" />

          <span className={`${fpsColor} whitespace-nowrap shrink-0`} title="实时渲染帧率">
            {fps} <span className="text-[10px] text-neutral-500 font-sans">FPS</span>
          </span>

          <span className="h-3 w-[1px] bg-white/10 shrink-0" />

          <span className={`${latencyColor} whitespace-nowrap shrink-0`} title="WebRTC 往返延迟">
            {latencyMs != null ? `${latencyMs} ms` : '--'}
          </span>

          <span className="h-3 w-[1px] bg-white/10 shrink-0" />

          <span className="text-neutral-300 text-[10px] whitespace-nowrap shrink-0" title="流分辨率">
            {videoResolution ? `${videoResolution.width}×${videoResolution.height}` : '无流'}
          </span>

          <span className="h-3 w-[1px] bg-white/10 shrink-0" />

          <span className="text-neutral-400 font-sans text-[10px] whitespace-nowrap shrink-0" title="音画状态">
            {status === 'connected' ? (muted ? '静音' : '声画同步') : '未连通'}
          </span>

          <span className="h-3 w-[1px] bg-white/10 shrink-0" />

          <span className={isStandalone ? "text-emerald-400 text-[10px] font-sans whitespace-nowrap shrink-0" : "text-neutral-400 text-[10px] font-sans whitespace-nowrap shrink-0"}>
            {isStandalone ? "PWA" : "网页"}
          </span>

          <button
            type="button"
            onClick={() => {
              setExpanded(false)
              if (onClose) onClose()
            }}
            className="ml-1 flex h-4 w-4 items-center justify-center rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            aria-label="收起 HUD"
            title="收起为紧凑模式"
          >
            <LuX size={11} />
          </button>
        </div>
      )}
    </div>
  )
}
