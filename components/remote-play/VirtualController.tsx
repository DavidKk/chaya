'use client'

import React, { useRef, useState } from 'react'
import { LuCheck, LuMenu, LuX, LuZap } from 'react-icons/lu'

import type { RemoteInputKey } from '@/lib/runtime/game-link-protocol'
import { haptic } from './haptic'

export type ControlMode = 'fixed' | 'dynamic' | 'single-left' | 'single-right' | 'touch'

type VirtualControllerProps = {
  onInput: (key: RemoteInputKey, action: 'down' | 'up') => void
  visible?: boolean
  idle?: boolean
  isPortrait?: boolean
  mode?: ControlMode
}

type Direction = 'up' | 'down' | 'left' | 'right'

const DEADZONE = 7
const THRESHOLD = 0.38

export function VirtualController({
  onInput,
  visible = true,
  idle = false,
  isPortrait = false,
  mode = 'fixed',
}: VirtualControllerProps) {
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dynamicOrigin, setDynamicOrigin] = useState<{ x: number; y: number } | null>(null)
  const baseRef = useRef<HTMLDivElement>(null)
  const activeDirsRef = useRef<Set<Direction>>(new Set())

  const maxRadius = isPortrait ? 38 : 28

  const triggerHaptic = (type: 'light' | 'medium' | 'heavy' | 'selection' = 'light') => {
    haptic.trigger(type)
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
        triggerHaptic('selection')
      }
      activeDirsRef.current = newDirs
    }
  }

  // --- Fixed Joystick Handlers ---
  const handleFixedPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    triggerHaptic('selection')
    handleFixedMove(e)
  }

  const handleFixedMove = (e: React.PointerEvent) => {
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

    const clampedDist = Math.min(dist, maxRadius)
    const angle = Math.atan2(dy, dx)
    const knobX = Math.cos(angle) * clampedDist
    const knobY = Math.sin(angle) * clampedDist
    setKnobOffset({ x: knobX, y: knobY })

    const normX = knobX / maxRadius
    const normY = knobY / maxRadius
    const nextDirs = new Set<Direction>()
    if (normY < -THRESHOLD) nextDirs.add('up')
    if (normY > THRESHOLD) nextDirs.add('down')
    if (normX < -THRESHOLD) nextDirs.add('left')
    if (normX > THRESHOLD) nextDirs.add('right')

    updateDirections(nextDirs)
  }

  const handleFixedPointerUp = (e: React.PointerEvent) => {
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

  // --- Dynamic Joystick Handlers (Touch anywhere on left side) ---
  const handleDynamicPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    setIsDragging(true)
    setDynamicOrigin({ x: e.clientX, y: e.clientY })
    setKnobOffset({ x: 0, y: 0 })
    updateDirections(new Set())
    triggerHaptic('selection')
  }

  const handleDynamicPointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dynamicOrigin) return
    const dx = e.clientX - dynamicOrigin.x
    const dy = e.clientY - dynamicOrigin.y
    const dist = Math.hypot(dx, dy)

    if (dist < DEADZONE) {
      setKnobOffset({ x: 0, y: 0 })
      updateDirections(new Set())
      return
    }

    const clampedDist = Math.min(dist, maxRadius)
    const angle = Math.atan2(dy, dx)
    const knobX = Math.cos(angle) * clampedDist
    const knobY = Math.sin(angle) * clampedDist
    setKnobOffset({ x: knobX, y: knobY })

    const normX = knobX / maxRadius
    const normY = knobY / maxRadius
    const nextDirs = new Set<Direction>()
    if (normY < -THRESHOLD) nextDirs.add('up')
    if (normY > THRESHOLD) nextDirs.add('down')
    if (normX < -THRESHOLD) nextDirs.add('left')
    if (normX > THRESHOLD) nextDirs.add('right')

    updateDirections(nextDirs)
  }

  const handleDynamicPointerUp = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    setIsDragging(false)
    setDynamicOrigin(null)
    setKnobOffset({ x: 0, y: 0 })
    updateDirections(new Set())
  }

  // --- Action Button Handlers ---
  const handleButtonPress = (key: RemoteInputKey, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    triggerHaptic(key === 'ok' ? 'medium' : 'light')
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

  // If invisible or in Touch Mode (Mode 2), don't render virtual buttons
  if (!visible || mode === 'touch') return null

  return (
    <>
      {/* Dynamic Joystick Spawn Base (Mode 3 active drag) */}
      {mode === 'dynamic' && dynamicOrigin && (
        <div
          style={{
            left: dynamicOrigin.x,
            top: dynamicOrigin.y,
            transform: 'translate(-50%, -50%)',
          }}
          className={`pointer-events-none fixed z-50 flex items-center justify-center rounded-full border border-white/30 bg-neutral-900/75 shadow-2xl backdrop-blur-md ${
            isPortrait ? 'h-32 w-32' : 'h-24 w-24'
          }`}
        >
          <div
            className={`pointer-events-none absolute rounded-full border border-white/15 ${
              isPortrait ? 'h-16 w-16' : 'h-12 w-12'
            }`}
          />
          <div className="pointer-events-none absolute top-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/25" />
          <div className="pointer-events-none absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/25" />
          <div className="pointer-events-none absolute top-1/2 left-1.5 h-1 w-1 -translate-y-1/2 rounded-full bg-white/25" />
          <div className="pointer-events-none absolute top-1/2 right-1.5 h-1 w-1 -translate-y-1/2 rounded-full bg-white/25" />

          {/* Dynamic Knob */}
          <div
            className={`pointer-events-none flex items-center justify-center rounded-full border border-white/40 bg-gradient-to-b from-neutral-700/95 to-neutral-800/95 shadow-xl shadow-emerald-500/25 ${
              isPortrait ? 'h-12 w-12' : 'h-8.5 w-8.5'
            }`}
            style={{
              transform: `translate3d(${knobOffset.x}px, ${knobOffset.y}px, 0)`,
            }}
          >
            <div
              className={`rounded-full border border-white/25 bg-white/10 shadow-inner ${
                isPortrait ? 'h-5 w-5' : 'h-3.5 w-3.5'
              }`}
            />
          </div>
        </div>
      )}

      {/* Mode 3 (Dynamic Joystick): Full left-screen touch interception area */}
      {mode === 'dynamic' && (
        <div
          onPointerDown={handleDynamicPointerDown}
          onPointerMove={isDragging ? handleDynamicPointerMove : undefined}
          onPointerUp={handleDynamicPointerUp}
          onPointerCancel={handleDynamicPointerUp}
          style={{ touchAction: 'none' }}
          className="pointer-events-auto fixed inset-y-0 left-0 w-[55%] touch-none z-30 select-none"
          role="slider"
          aria-label="虚拟摇杆"
        />
      )}

      {/* Main Controller Overlay */}
      <div
        style={{
          paddingLeft: 'max(1.25rem, env(safe-area-inset-left))',
          paddingRight: 'max(1.25rem, env(safe-area-inset-right))',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
        className={`pointer-events-none fixed inset-0 z-40 flex select-none flex-col justify-end transition-opacity duration-300 ${
          idle && !isDragging ? 'opacity-25 hover:opacity-90' : 'opacity-85 hover:opacity-100'
        }`}
      >
        {(() => {
          const renderJoystick = (sizeClass?: string) => (
            <div
              ref={baseRef}
              onPointerDown={handleFixedPointerDown}
              onPointerMove={isDragging ? handleFixedMove : undefined}
              onPointerUp={handleFixedPointerUp}
              onPointerCancel={handleFixedPointerUp}
              className={`pointer-events-auto relative flex touch-none items-center justify-center rounded-full border border-white/20 bg-neutral-900/50 shadow-2xl backdrop-blur-md active:border-white/30 shrink-0 ${
                sizeClass || (isPortrait ? 'h-32 w-32' : 'h-24 w-24')
              }`}
              style={{ touchAction: 'none' }}
              role="slider"
              aria-label="虚拟摇杆"
            >
              <div
                className={`pointer-events-none absolute rounded-full border border-white/10 ${
                  isPortrait ? 'h-16 w-16' : 'h-12 w-12'
                }`}
              />
              <div className="pointer-events-none absolute top-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/25" />
              <div className="pointer-events-none absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/25" />
              <div className="pointer-events-none absolute top-1/2 left-1.5 h-1 w-1 -translate-y-1/2 rounded-full bg-white/25" />
              <div className="pointer-events-none absolute top-1/2 right-1.5 h-1 w-1 -translate-y-1/2 rounded-full bg-white/25" />

              <div
                className={`pointer-events-none flex items-center justify-center rounded-full border border-white/35 bg-gradient-to-b from-neutral-700/90 to-neutral-800/95 shadow-xl ${
                  isPortrait ? 'h-12 w-12' : 'h-8.5 w-8.5'
                } ${isDragging ? 'shadow-emerald-500/20' : 'transition-transform duration-150 ease-out'}`}
                style={{
                  transform: `translate3d(${knobOffset.x}px, ${knobOffset.y}px, 0)`,
                }}
              >
                <div
                  className={`rounded-full border border-white/25 bg-white/10 shadow-inner ${
                    isPortrait ? 'h-5 w-5' : 'h-3.5 w-3.5'
                  }`}
                />
              </div>
            </div>
          )

          const renderActionButtons = (compact = false, align: 'start' | 'end' = 'end') => (
            <div
              className={`pointer-events-auto relative flex flex-col ${align === 'start' ? 'items-start' : 'items-end'} gap-1.5 sm:gap-2 touch-none shrink-0`}
              style={{ touchAction: 'none' }}
            >
              {/* Top row: Menu & Dash */}
              <div className={`flex items-center gap-2 ${align === 'start' ? 'pl-1' : 'pr-1'}`}>
                <button
                  type="button"
                  onPointerDown={(e) => handleButtonPress('menu', e)}
                  onPointerUp={(e) => handleButtonRelease('menu', e)}
                  onPointerCancel={(e) => handleButtonRelease('menu', e)}
                  className={`flex items-center justify-center rounded-full border border-purple-400/40 bg-purple-950/70 text-purple-200 shadow-md backdrop-blur-md transition-transform active:scale-90 ${
                    isPortrait ? (compact ? 'h-8 w-8' : 'h-10 w-10') : 'h-8 w-8'
                  }`}
                  aria-label="菜单"
                  title="菜单"
                >
                  <LuMenu size={isPortrait ? (compact ? 14 : 17) : 14} className="stroke-[2.2]" />
                </button>

                <button
                  type="button"
                  onPointerDown={(e) => handleButtonPress('shift', e)}
                  onPointerUp={(e) => handleButtonRelease('shift', e)}
                  onPointerCancel={(e) => handleButtonRelease('shift', e)}
                  className={`flex items-center justify-center rounded-full border border-amber-400/40 bg-amber-950/70 text-amber-200 shadow-md backdrop-blur-md transition-transform active:scale-90 ${
                    isPortrait ? (compact ? 'h-8 w-8' : 'h-10 w-10') : 'h-8 w-8'
                  }`}
                  aria-label="加速"
                  title="加速"
                >
                  <LuZap size={isPortrait ? (compact ? 14 : 17) : 14} className="stroke-[2.2]" />
                </button>
              </div>

              {/* Bottom row: Cancel (B) & Confirm (A) */}
              <div className="flex items-center gap-2 sm:gap-2.5">
                <button
                  type="button"
                  onPointerDown={(e) => handleButtonPress('cancel', e)}
                  onPointerUp={(e) => handleButtonRelease('cancel', e)}
                  onPointerCancel={(e) => handleButtonRelease('cancel', e)}
                  className={`flex items-center justify-center rounded-full border border-rose-400/50 bg-rose-950/70 text-rose-100 shadow-lg backdrop-blur-md transition-transform active:scale-90 ${
                    isPortrait ? (compact ? 'h-10.5 w-10.5' : 'h-12 w-12') : 'h-9.5 w-9.5'
                  }`}
                  aria-label="取消"
                  title="取消"
                >
                  <LuX size={isPortrait ? (compact ? 17 : 20) : 16} className="stroke-[2.5]" />
                </button>

                <button
                  type="button"
                  onPointerDown={(e) => handleButtonPress('ok', e)}
                  onPointerUp={(e) => handleButtonRelease('ok', e)}
                  onPointerCancel={(e) => handleButtonRelease('ok', e)}
                  className={`flex items-center justify-center rounded-full border-2 border-emerald-400/70 bg-emerald-600/85 text-white shadow-xl shadow-emerald-950/50 backdrop-blur-md transition-transform active:scale-90 ${
                    isPortrait ? (compact ? 'h-13 w-13' : 'h-15 w-15') : 'h-11.5 w-11.5'
                  }`}
                  aria-label="确认"
                  title="确认"
                >
                  <LuCheck size={isPortrait ? (compact ? 22 : 26) : 20} className="stroke-[2.8]" />
                </button>
              </div>
            </div>
          )

          if (mode === 'single-right') {
            return (
              <div className="flex w-full items-end justify-end gap-5 sm:gap-7 pr-6 sm:pr-10 pb-4 sm:pb-6">
                {renderJoystick(isPortrait ? 'h-24 w-24' : 'h-20 w-20')}
                <div className="mr-2 sm:mr-4">
                  {renderActionButtons(true, 'end')}
                </div>
              </div>
            )
          }

          if (mode === 'single-left') {
            return (
              <div className="flex w-full items-end justify-start gap-5 sm:gap-7 pl-6 sm:pl-10 pb-4 sm:pb-6">
                <div className="ml-2 sm:ml-4">
                  {renderActionButtons(true, 'start')}
                </div>
                {renderJoystick(isPortrait ? 'h-24 w-24' : 'h-20 w-20')}
              </div>
            )
          }

          if (mode === 'dynamic') {
            return (
              <div className="flex w-full items-end justify-end">
                {renderActionButtons()}
              </div>
            )
          }

          return (
            <div className="flex w-full items-end justify-between">
              {renderJoystick()}
              {renderActionButtons()}
            </div>
          )
        })()}
      </div>
    </>
  )
}
