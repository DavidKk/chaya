'use client'

import React, { useEffect, useRef, useState } from 'react'
import { LuActivity, LuX } from 'react-icons/lu'

type PerformanceHudProps = {
  visible: boolean
  latencyMs?: number | null
  videoResolution?: { width: number; height: number } | null
  status: 'connecting' | 'connected' | 'disconnected'
  muted: boolean
  onClose: () => void
}

export function PerformanceHud({
  visible,
  latencyMs,
  videoResolution,
  status,
  muted,
  onClose,
}: PerformanceHudProps) {
  const [fps, setFps] = useState<number>(60)
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
    <div className="pointer-events-auto fixed top-14 left-3 sm:left-4 z-30 flex items-center gap-2 rounded-xl border border-white/10 bg-neutral-950/85 px-3 py-1.5 font-mono text-[11px] text-neutral-300 shadow-xl backdrop-blur-md select-none">
      <div className="flex items-center gap-1.5 text-neutral-400 font-sans">
        <LuActivity size={13} className="text-emerald-400" />
        <span className="font-semibold text-neutral-200">HUD</span>
      </div>

      <span className="h-3 w-[1px] bg-white/10" />

      <span className={fpsColor} title="实时渲染帧率">
        {fps} <span className="text-[10px] text-neutral-500 font-sans">FPS</span>
      </span>

      <span className="h-3 w-[1px] bg-white/10" />

      <span className={latencyColor} title="WebRTC 往返延迟">
        {latencyMs != null ? `${latencyMs} ms` : '--'}
      </span>

      <span className="h-3 w-[1px] bg-white/10" />

      <span className="text-neutral-300" title="流分辨率">
        {videoResolution ? `${videoResolution.width}×${videoResolution.height}` : '无流'}
      </span>

      <span className="h-3 w-[1px] bg-white/10" />

      <span className="text-neutral-400 font-sans text-[10px]" title="音视频状态">
        {status === 'connected' ? (muted ? '静音' : '声画同步') : '未连通'}
      </span>

      <button
        type="button"
        onClick={onClose}
        className="ml-1 flex h-4 w-4 items-center justify-center rounded-full text-neutral-500 hover:text-white"
        aria-label="关闭 HUD"
      >
        <LuX size={12} />
      </button>
    </div>
  )
}
