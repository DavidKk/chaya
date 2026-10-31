'use client'

import React, { useRef, useState } from 'react'

import type { RemoteInputKey } from '@/lib/runtime/game-link-protocol'

type VirtualControllerProps = {
  onInput: (key: RemoteInputKey, action: 'down' | 'up') => void
  visible?: boolean
}

type Direction = 'up' | 'down' | 'left' | 'right' | null

export function VirtualController({ onInput, visible = true }: VirtualControllerProps) {
  const [activeDir, setActiveDir] = useState<Direction>(null)
  const dpadRef = useRef<HTMLDivElement>(null)
  const activeDirRef = useRef<Direction>(null)

  const triggerHaptic = () => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(10)
      }
    } catch {
      /* ignore */
    }
  }

  const updateDirection = (newDir: Direction) => {
    const prev = activeDirRef.current
    if (prev === newDir) return

    if (prev) {
      onInput(prev, 'up')
    }
    if (newDir) {
      onInput(newDir, 'down')
      triggerHaptic()
    }
    activeDirRef.current = newDir
    setActiveDir(newDir)
  }

  const handleDpadPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    handleDpadMove(e)
  }

  const handleDpadMove = (e: React.PointerEvent) => {
    const el = dpadRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = e.clientX - cx
    const dy = e.clientY - cy
    const dist = Math.hypot(dx, dy)

    if (dist < 15) {
      updateDirection(null)
      return
    }

    const angle = (Math.atan2(dy, dx) * 180) / Math.PI
    let dir: Direction = null
    if (angle >= -45 && angle < 45) {
      dir = 'right'
    } else if (angle >= 45 && angle < 135) {
      dir = 'down'
    } else if (angle >= -135 && angle < -45) {
      dir = 'up'
    } else {
      dir = 'left'
    }
    updateDirection(dir)
  }

  const handleDpadPointerUp = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    updateDirection(null)
  }

  const handleButtonPress = (key: RemoteInputKey, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    triggerHaptic()
    onInput(key, 'down')
  }

  const handleButtonRelease = (key: RemoteInputKey, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    onInput(key, 'up')
  }

  if (!visible) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex select-none flex-col justify-end p-4 pb-8 sm:p-6 sm:pb-10">
      <div className="flex w-full items-end justify-between">
        {/* Left: Direction Pad (D-Pad) */}
        <div
          ref={dpadRef}
          onPointerDown={handleDpadPointerDown}
          onPointerMove={handleDpadMove}
          onPointerUp={handleDpadPointerUp}
          onPointerCancel={handleDpadPointerUp}
          className="pointer-events-auto relative flex h-40 w-40 touch-none items-center justify-center rounded-full border border-white/20 bg-neutral-900/60 shadow-2xl backdrop-blur-md active:bg-neutral-900/80"
          style={{ touchAction: 'none' }}
        >
          {/* Visual cross overlay */}
          <div className="absolute inset-x-8 top-1/2 h-10 -translate-y-1/2 rounded-md bg-white/5" />
          <div className="absolute inset-y-8 left-1/2 w-10 -translate-x-1/2 rounded-md bg-white/5" />

          {/* D-Pad Buttons visual indicators */}
          <div
            className={`absolute top-2 left-1/2 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-lg text-lg font-bold transition-colors ${
              activeDir === 'up' ? 'bg-emerald-500/80 text-white' : 'text-neutral-300'
            }`}
          >
            ▲
          </div>
          <div
            className={`absolute bottom-2 left-1/2 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-lg text-lg font-bold transition-colors ${
              activeDir === 'down' ? 'bg-emerald-500/80 text-white' : 'text-neutral-300'
            }`}
          >
            ▼
          </div>
          <div
            className={`absolute top-1/2 left-2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-lg font-bold transition-colors ${
              activeDir === 'left' ? 'bg-emerald-500/80 text-white' : 'text-neutral-300'
            }`}
          >
            ◀
          </div>
          <div
            className={`absolute top-1/2 right-2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-lg font-bold transition-colors ${
              activeDir === 'right' ? 'bg-emerald-500/80 text-white' : 'text-neutral-300'
            }`}
          >
            ▶
          </div>

          {/* Center thumb stick indicator */}
          <div
            className={`h-12 w-12 rounded-full border border-white/30 bg-neutral-800/80 shadow-md transition-transform duration-75 ${
              activeDir === 'up'
                ? '-translate-y-3'
                : activeDir === 'down'
                  ? 'translate-y-3'
                  : activeDir === 'left'
                    ? '-translate-x-3'
                    : activeDir === 'right'
                      ? 'translate-x-3'
                      : ''
            }`}
          />
        </div>

        {/* Right: Action Buttons (A / B / Dash / Menu) */}
        <div className="pointer-events-auto relative grid h-44 w-44 touch-none grid-cols-2 gap-3" style={{ touchAction: 'none' }}>
          {/* Menu / Esc */}
          <button
            type="button"
            onPointerDown={(e) => handleButtonPress('menu', e)}
            onPointerUp={(e) => handleButtonRelease('menu', e)}
            onPointerCancel={(e) => handleButtonRelease('menu', e)}
            className="flex h-16 w-16 items-center justify-center rounded-full border border-purple-400/40 bg-purple-950/60 text-xs font-semibold text-purple-200 shadow-lg backdrop-blur-md transition-transform active:scale-90"
          >
            菜单
          </button>

          {/* Shift / Dash */}
          <button
            type="button"
            onPointerDown={(e) => handleButtonPress('shift', e)}
            onPointerUp={(e) => handleButtonRelease('shift', e)}
            onPointerCancel={(e) => handleButtonRelease('shift', e)}
            className="flex h-16 w-16 items-center justify-center rounded-full border border-amber-400/40 bg-amber-950/60 text-xs font-semibold text-amber-200 shadow-lg backdrop-blur-md transition-transform active:scale-90"
          >
            加速
          </button>

          {/* Cancel / B */}
          <button
            type="button"
            onPointerDown={(e) => handleButtonPress('cancel', e)}
            onPointerUp={(e) => handleButtonRelease('cancel', e)}
            onPointerCancel={(e) => handleButtonRelease('cancel', e)}
            className="flex h-18 w-18 items-center justify-center rounded-full border border-rose-400/50 bg-rose-950/70 text-base font-bold text-rose-100 shadow-lg backdrop-blur-md transition-transform active:scale-90"
          >
            B / 取消
          </button>

          {/* OK / A */}
          <button
            type="button"
            onPointerDown={(e) => handleButtonPress('ok', e)}
            onPointerUp={(e) => handleButtonRelease('ok', e)}
            onPointerCancel={(e) => handleButtonRelease('ok', e)}
            className="flex h-18 w-18 items-center justify-center rounded-full border border-emerald-400/60 bg-emerald-700/80 text-base font-bold text-white shadow-xl backdrop-blur-md transition-transform active:scale-90"
          >
            A / 确定
          </button>
        </div>
      </div>
    </div>
  )
}
