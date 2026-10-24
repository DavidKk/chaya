'use client'

import { useEffect, useRef, useState } from 'react'

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}

/**
 * 数字缓动：目标变化时在 durationMs 内从当前值滚到新值（默认 1.5s）。
 * 首帧直接落到目标，避免进页 6+ 个统计格同时从 0 滚动造成卡顿。
 * 尊重 prefers-reduced-motion。
 */
export function useAnimatedNumber(target: number, durationMs = 1500): number {
  const [display, setDisplay] = useState(() => Math.round(target))
  const displayRef = useRef(display)
  const frameRef = useRef(0)
  const primed = useRef(false)

  useEffect(() => {
    displayRef.current = display
  }, [display])

  useEffect(() => {
    const to = Number.isFinite(target) ? target : 0
    const from = displayRef.current
    if (from === to) {
      primed.current = true
      return
    }

    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // First paint / cold mount: snap. Later deltas (running job) still ease.
    if (!primed.current || reduce || durationMs <= 0) {
      primed.current = true
      displayRef.current = Math.round(to)
      setDisplay(Math.round(to))
      return
    }

    const start = performance.now()
    cancelAnimationFrame(frameRef.current)

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const next = from + (to - from) * easeOutCubic(t)
      const rounded = t >= 1 ? Math.round(to) : Math.round(next)
      displayRef.current = rounded
      setDisplay(rounded)
      if (t < 1) frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [target, durationMs])

  return display
}
