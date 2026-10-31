'use client'

import React, { useRef, useState } from 'react'
import { LuCheck, LuMenu, LuX, LuZap } from 'react-icons/lu'

import type { RemoteInputKey } from '@/lib/runtime/game-link-protocol'

type VirtualControllerProps = {
  onInput: (key: RemoteInputKey, action: 'down' | 'up') => void
  visible?: boolean
  idle?: boolean
}

type Direction = 'up' | 'down' | 'left' | 'right'

const MAX_RADIUS = 34
const DEADZONE = 8
const THRESHOLD = 0.38

export function VirtualController({ onInput, visible = true, idle = false }: VirtualControllerProps) {
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const baseRef = useRef<HTMLDivElement>(null)
  const activeDirsRef = useRef<Set<Direction>>(new Set())

  const triggerHaptic = () => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(10)
      }
    } catch {
      /* ignore */
    }
  }

  const updateDirections = (newDirs: Set<Direction>) => {
    const prev = activeDirsRef.current
    let changed = false

    // Release directions no longer active
    for (const dir of prev) {
      if (!newDirs.has(dir)) {
        onInput(dir, 'up')
        changed = true
      }
    }

    // Press newly active directions
    for (const dir of newDirs) {
      if (!prev.has(dir)) {
        onInput(dir, 'down')
        changed = true
      }
    }

    if (changed) {
      if (newDirs.size > 0 && prev.size === 0) {
        triggerHaptic()
      }
      activeDirsRef.current = newDirs
    }
  }

  const handleJoystickPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    handleJoystickMove(e)
  }

  const handleJoystickMove = (e: React.PointerEvent) => {
    const el = baseRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = e.clientX - cx
    const dy = e.clientY - cy
    const dist = Math.hypot(dx, dy)

    if (dist < DEADZONE) {
      setKnobOffset({ x: 0, y: 0 })
      updateDirections(new Set())
      return
    }

    const clampedDist = Math.min(dist, MAX_RADIUS)
    const angle = Math.atan2(dy, dx)
    const knobX = Math.cos(angle) * clampedDist
    const knobY = Math.sin(angle) * clampedDist
    setKnobOffset({ x: knobX, y: knobY })

    const normX = knobX / MAX_RADIUS
    const normY = knobY / MAX_RADIUS
    const nextDirs = new Set<Direction>()
    if (normY < -THRESHOLD) nextDirs.add('up')
    if (normY > THRESHOLD) nextDirs.add('down')
    if (normX < -THRESHOLD) nextDirs.add('left')
    if (normX > THRESHOLD) nextDirs.add('right')

    updateDirections(nextDirs)
  }

  const handleJoystickPointerUp = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    setIsDragging(false)
    setKnobOffset({ x: 0, y: 0 })
    updateDirections(new Set())
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
    <div
      style={{
        paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
        paddingRight: "max(0.75rem, env(safe-area-inset-right))",
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
      }}
      className={`pointer-events-none fixed inset-0 z-40 flex select-none flex-col justify-end p-3 pb-3 sm:p-5 sm:pb-5 transition-opacity duration-300 ${
        idle && !isDragging ? 'opacity-25 hover:opacity-90' : 'opacity-85 hover:opacity-100'
      }`}
    >
      <div className="flex w-full items-end justify-between">
        {/* Left: Mobile Analog Joystick */}
        <div
          ref={baseRef}
          onPointerDown={handleJoystickPointerDown}
          onPointerMove={isDragging ? handleJoystickMove : undefined}
          onPointerUp={handleJoystickPointerUp}
          onPointerCancel={handleJoystickPointerUp}
          className="pointer-events-auto relative flex h-28 w-28 touch-none items-center justify-center rounded-full border border-white/20 bg-neutral-900/50 shadow-2xl backdrop-blur-md active:border-white/30"
          style={{ touchAction: 'none' }}
          role="slider"
          aria-label="虚拟摇杆"
        >
          {/* Subtle concentric reference ring */}
          <div className="pointer-events-none absolute h-14 w-14 rounded-full border border-white/10" />

          {/* 4 Directional reference notches */}
          <div className="pointer-events-none absolute top-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/25" />
          <div className="pointer-events-none absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/25" />
          <div className="pointer-events-none absolute top-1/2 left-1.5 h-1 w-1 -translate-y-1/2 rounded-full bg-white/25" />
          <div className="pointer-events-none absolute top-1/2 right-1.5 h-1 w-1 -translate-y-1/2 rounded-full bg-white/25" />

          {/* Movable Joystick Knob */}
          <div
            className={`pointer-events-none flex h-10 w-10 items-center justify-center rounded-full border border-white/35 bg-gradient-to-b from-neutral-700/90 to-neutral-800/95 shadow-xl ${
              isDragging ? 'shadow-emerald-500/20' : 'transition-transform duration-150 ease-out'
            }`}
            style={{
              transform: `translate3d(${knobOffset.x}px, ${knobOffset.y}px, 0)`,
            }}
          >
            {/* Center thumb tactile ring */}
            <div className="h-4 w-4 rounded-full border border-white/25 bg-white/10 shadow-inner" />
          </div>
        </div>

        {/* Right: Action Buttons with Pure React Icons */}
        <div className="pointer-events-auto relative flex flex-col items-end gap-2 touch-none" style={{ touchAction: 'none' }}>
          {/* Top row: Menu & Dash */}
          <div className="flex items-center gap-2 pr-1.5">
            {/* Menu (Esc) */}
            <button
              type="button"
              onPointerDown={(e) => handleButtonPress('menu', e)}
              onPointerUp={(e) => handleButtonRelease('menu', e)}
              onPointerCancel={(e) => handleButtonRelease('menu', e)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-purple-400/40 bg-purple-950/70 text-purple-200 shadow-md backdrop-blur-md transition-transform active:scale-90"
              aria-label="菜单"
              title="菜单"
            >
              <LuMenu size={16} className="stroke-[2.2]" />
            </button>

            {/* Dash / Shift */}
            <button
              type="button"
              onPointerDown={(e) => handleButtonPress('shift', e)}
              onPointerUp={(e) => handleButtonRelease('shift', e)}
              onPointerCancel={(e) => handleButtonRelease('shift', e)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-amber-400/40 bg-amber-950/70 text-amber-200 shadow-md backdrop-blur-md transition-transform active:scale-90"
              aria-label="加速"
              title="加速"
            >
              <LuZap size={16} className="stroke-[2.2]" />
            </button>
          </div>

          {/* Bottom row: Cancel (B) & Confirm (A) */}
          <div className="flex items-center gap-2.5">
            {/* Cancel (B / Esc) */}
            <button
              type="button"
              onPointerDown={(e) => handleButtonPress('cancel', e)}
              onPointerUp={(e) => handleButtonRelease('cancel', e)}
              onPointerCancel={(e) => handleButtonRelease('cancel', e)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-rose-400/50 bg-rose-950/70 text-rose-100 shadow-lg backdrop-blur-md transition-transform active:scale-90"
              aria-label="取消"
              title="取消"
            >
              <LuX size={18} className="stroke-[2.5]" />
            </button>

            {/* Confirm (A / OK) */}
            <button
              type="button"
              onPointerDown={(e) => handleButtonPress('ok', e)}
              onPointerUp={(e) => handleButtonRelease('ok', e)}
              onPointerCancel={(e) => handleButtonRelease('ok', e)}
              className="flex h-13 w-13 items-center justify-center rounded-full border-2 border-emerald-400/70 bg-emerald-600/85 text-white shadow-xl shadow-emerald-950/50 backdrop-blur-md transition-transform active:scale-90"
              aria-label="确认"
              title="确认"
            >
              <LuCheck size={22} className="stroke-[2.8]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
