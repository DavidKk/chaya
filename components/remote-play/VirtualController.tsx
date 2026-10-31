'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
  LuCheck,
  LuFolderOpen,
  LuMenu,
  LuMessageSquareText,
  LuPackage,
  LuSave,
  LuShield,
  LuSlidersHorizontal,
  LuX,
} from 'react-icons/lu'
import { useT } from '@/components/i18n/LocaleProvider'

import type { RemoteInputKey } from '@/lib/runtime/game-link-protocol'
import { haptic } from './haptic'

export type ControlMode = 'fixed' | 'dynamic' | 'single-left' | 'single-right' | 'touch'

type VirtualControllerProps = {
  onInput: (key: RemoteInputKey, action: 'down' | 'up') => void
  onAction?: (actionId: string) => void
  onOpenDrawer?: () => void
  visible?: boolean
  idle?: boolean
  isPortrait?: boolean
  mode?: ControlMode
  opacity?: number
  autoTalk?: boolean
}

type Direction = 'up' | 'down' | 'left' | 'right'

const DEADZONE = 7
const THRESHOLD = 0.38

const SATELLITE_ORBIT_ANGLES = [110, 145, 180, 215, 250] // 5 satellite items fanning inwards

export function VirtualController({
  onInput,
  onAction,
  onOpenDrawer,
  visible = true,
  idle = false,
  isPortrait = false,
  mode = 'fixed',
  opacity = 0.65,
  autoTalk = false,
}: VirtualControllerProps) {
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dynamicOrigin, setDynamicOrigin] = useState<{ x: number; y: number } | null>(null)
  const [shortcutsExpanded, setShortcutsExpanded] = useState(false)
  const t = useT()
  const baseRef = useRef<HTMLDivElement>(null)
  const activeDirsRef = useRef<Set<Direction>>(new Set())

  // --- AssistiveTouch-style Draggable Floating Ball State ---
  const [ballPos, setBallPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [ballSide, setBallSide] = useState<'left' | 'right'>('right')
  const [isBallDragging, setIsBallDragging] = useState(false)
  const [isBallIdle, setIsBallIdle] = useState(false)
  const ballIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ballDragStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number } | null>(null)
  const ballMovedDistRef = useRef(0)

  const maxRadius = isPortrait ? 38 : 28
  const ballSize = isPortrait ? 42 : 38

  const triggerHaptic = (type: 'light' | 'medium' | 'heavy' | 'selection' = 'light') => {
    haptic.trigger(type)
  }

  // Restore & initialize floating ball position from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return

    const updateBallDockPosition = () => {
      try {
        const savedSide = (localStorage.getItem('chaya_remote_ball_side') as 'left' | 'right') || 'right'
        const savedRatioStr = localStorage.getItem('chaya_remote_ball_y_ratio')
        const ratio = savedRatioStr ? parseFloat(savedRatioStr) : (isPortrait ? 0.46 : 0.40)
        const clampedRatio = Math.max(0.12, Math.min(0.82, isNaN(ratio) ? 0.45 : ratio))

        const targetY = Math.round(window.innerHeight * clampedRatio)
        const edgeMargin = isPortrait ? 22 : 26
        const targetX = savedSide === 'left' ? edgeMargin : Math.max(edgeMargin, window.innerWidth - ballSize - edgeMargin)

        setBallSide(savedSide)
        setBallPos({ x: targetX, y: targetY })
      } catch {
        setBallSide('right')
        const edgeMargin = isPortrait ? 22 : 26
        setBallPos({ x: Math.max(edgeMargin, window.innerWidth - ballSize - edgeMargin), y: Math.round(window.innerHeight * 0.45) })
      }
    }

    updateBallDockPosition()
    window.addEventListener('resize', updateBallDockPosition)
    window.addEventListener('orientationchange', updateBallDockPosition)
    return () => {
      window.removeEventListener('resize', updateBallDockPosition)
      window.removeEventListener('orientationchange', updateBallDockPosition)
    }
  }, [ballSize, isPortrait])

  // Ball idle auto-dimming timer (dims to semi-transparent when idle, restores on touch)
  const resetBallIdleTimer = () => {
    setIsBallIdle(false)
    if (ballIdleTimerRef.current) clearTimeout(ballIdleTimerRef.current)
    ballIdleTimerRef.current = setTimeout(() => {
      setIsBallIdle(true)
    }, 2800)
  }

  useEffect(() => {
    if (shortcutsExpanded || isBallDragging) {
      setIsBallIdle(false)
      if (ballIdleTimerRef.current) clearTimeout(ballIdleTimerRef.current)
    } else {
      resetBallIdleTimer()
    }
    return () => {
      if (ballIdleTimerRef.current) clearTimeout(ballIdleTimerRef.current)
    }
  }, [shortcutsExpanded, isBallDragging])

  // --- Floating Ball Drag & Tap Handlers ---
  const handleBallPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resetBallIdleTimer()
    ballMovedDistRef.current = 0

    // When shortcuts are expanded, lock dragging to prevent accidental movement
    if (shortcutsExpanded) {
      return
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    ballDragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      startX: ballPos.x,
      startY: ballPos.y,
    }
    setIsBallDragging(true)
  }

  const handleBallPointerMove = (e: React.PointerEvent) => {
    if (!isBallDragging || !ballDragStartRef.current) return
    const dx = e.clientX - ballDragStartRef.current.clientX
    const dy = e.clientY - ballDragStartRef.current.clientY
    ballMovedDistRef.current = Math.hypot(dx, dy)

    const edgeMargin = isPortrait ? 22 : 26
    const nextX = Math.max(edgeMargin, Math.min(window.innerWidth - ballSize - edgeMargin, ballDragStartRef.current.startX + dx))
    const nextY = Math.max(48, Math.min(window.innerHeight - ballSize - 54, ballDragStartRef.current.startY + dy))
    setBallPos({ x: nextX, y: nextY })
  }

  const handleBallPointerUp = (e: React.PointerEvent) => {
    if (!isBallDragging) return
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    setIsBallDragging(false)

    // Tap gesture (< 7px drag distance) toggles radial menu
    if (ballMovedDistRef.current < 7) {
      triggerHaptic('selection')
      setShortcutsExpanded((prev) => !prev)
      resetBallIdleTimer()
      return
    }

    // Drag gesture released: Snap to nearest edge (iOS AssistiveTouch style)
    const midX = window.innerWidth / 2
    const currentCx = ballPos.x + ballSize / 2
    const snappedSide: 'left' | 'right' = currentCx < midX ? 'left' : 'right'
    const edgeMargin = isPortrait ? 22 : 26
    const snappedX = snappedSide === 'left' ? edgeMargin : Math.max(edgeMargin, window.innerWidth - ballSize - edgeMargin)
    const clampedY = Math.max(48, Math.min(window.innerHeight - ballSize - 54, ballPos.y))

    setBallSide(snappedSide)
    setBallPos({ x: snappedX, y: clampedY })
    triggerHaptic('light')
    resetBallIdleTimer()

    // Persist position ratio & snapped side
    try {
      localStorage.setItem('chaya_remote_ball_side', snappedSide)
      const ratio = (clampedY / window.innerHeight).toFixed(4)
      localStorage.setItem('chaya_remote_ball_y_ratio', ratio)
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
        triggerHaptic('selection')
      }
      activeDirsRef.current = newDirs
    }
  }

  // --- Fixed Joystick Handlers ---
  const handleFixedPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (shortcutsExpanded) setShortcutsExpanded(false)
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
    if (shortcutsExpanded) setShortcutsExpanded(false)
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
    if (shortcutsExpanded) setShortcutsExpanded(false)
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

  const handleShortcutClick = (actionId: string) => {
    triggerHaptic('medium')
    setShortcutsExpanded(false)
    onAction?.(actionId)
  }

  // If invisible or in Touch Mode (Mode 2), don't render virtual buttons
  if (!visible || mode === 'touch') return null

  // Radial satellite items around the floating ball (Pure icons, zero text)
  const satellites = [
    { id: 'scene:item', label: '背包', icon: LuPackage, color: 'text-amber-400', border: 'border-amber-400/40 bg-neutral-900/90' },
    { id: 'scene:equip', label: '装备', icon: LuShield, color: 'text-indigo-400', border: 'border-indigo-400/40 bg-neutral-900/90' },
    { id: 'scene:save', label: '存档', icon: LuSave, color: 'text-emerald-400', border: 'border-emerald-400/40 bg-neutral-900/90' },
    { id: 'scene:load', label: '读档', icon: LuFolderOpen, color: 'text-sky-400', border: 'border-sky-400/40 bg-neutral-900/90' },
    { id: 'flag:autotalk', label: '自动对话', icon: LuMessageSquareText, color: 'text-cyan-400', border: autoTalk ? 'border-sky-400 bg-sky-950/90 text-sky-200' : 'border-cyan-400/40 bg-neutral-900/90' },
  ]

  const orbitRadius = isPortrait ? 72 : 64

  return (
    <>
      {/* Backdrop to dismiss expandable shortcuts dock when clicking outside */}
      {shortcutsExpanded && (
        <div
          className="pointer-events-auto fixed inset-0 z-40 bg-transparent"
          onClick={() => setShortcutsExpanded(false)}
        />
      )}

      {/* AssistiveTouch-style Draggable Floating Ball & Radial Orbit */}
      <div
        style={{
          transform: `translate3d(${ballPos.x}px, ${ballPos.y}px, 0)`,
          touchAction: 'none',
        }}
        className={`pointer-events-auto fixed top-0 left-0 z-50 select-none ${
          isBallDragging ? 'cursor-grabbing transition-none' : 'transition-transform duration-200 ease-out'
        }`}
      >
        {/* Radial Satellite Orbit Items (Pure Icons fanning into screen) */}
        {shortcutsExpanded && (
          <div className="absolute inset-0 pointer-events-none">
            {satellites.map((sat, index) => {
              const baseAngle = SATELLITE_ORBIT_ANGLES[index] ?? (110 + index * 28)
              const angleRad = (baseAngle * Math.PI) / 180
              // If docked on left, mirror horizontally so satellites fan rightwards into screen
              const dx = (ballSide === 'left' ? -Math.cos(angleRad) : Math.cos(angleRad)) * orbitRadius
              const dy = Math.sin(angleRad) * orbitRadius

              const Icon = sat.icon
              return (
                <button
                  key={sat.id}
                  type="button"
                  data-action={sat.id}
                  onClick={() => handleShortcutClick(sat.id)}
                  style={{
                    left: `${ballSize / 2}px`,
                    top: `${ballSize / 2}px`,
                    transform: `translate3d(calc(-50% + ${dx}px), calc(-50% + ${dy}px), 0)`,
                  }}
                  className={`pointer-events-auto absolute flex h-8.5 w-8.5 sm:h-9 sm:w-9 items-center justify-center rounded-full border shadow-2xl backdrop-blur-xl transition-transform active:scale-90 animate-in fade-in zoom-in-75 duration-150 ${sat.border}`}
                  aria-label={sat.label}
                  title={sat.label}
                >
                  <Icon size={15} className={sat.color} />
                </button>
              )
            })}
          </div>
        )}

        {/* Central Floating Ball (AssistiveTouch Circle) */}
        <button
          type="button"
          onPointerDown={handleBallPointerDown}
          onPointerMove={handleBallPointerMove}
          onPointerUp={handleBallPointerUp}
          onPointerCancel={handleBallPointerUp}
          onClick={() => {
            if (shortcutsExpanded) {
              triggerHaptic('selection')
              setShortcutsExpanded(false)
              resetBallIdleTimer()
              return
            }
            if (ballMovedDistRef.current < 7) {
              triggerHaptic('selection')
              setShortcutsExpanded(true)
              resetBallIdleTimer()
            }
          }}
          style={{
            touchAction: 'none',
          }}
          className={`flex items-center justify-center rounded-full border shadow-2xl backdrop-blur-xl transition-all duration-300 active:scale-95 ${
            isPortrait ? 'h-10.5 w-10.5' : 'h-9.5 w-9.5'
          } ${
            shortcutsExpanded
              ? 'border-emerald-400 bg-emerald-950/90 text-emerald-300 shadow-emerald-500/30'
              : 'border-white/30 bg-neutral-900/80 text-white shadow-black/60'
          } ${isBallIdle && !shortcutsExpanded && !isBallDragging ? 'opacity-35 hover:opacity-100' : 'opacity-100'}`}
          aria-label="快捷配置"
          title="快捷配置 (拖动贴边 / 点击展开)"
          aria-expanded={shortcutsExpanded}
        >
          {/* iOS AssistiveTouch Style Concentric Ring */}
          <div
            className={`flex items-center justify-center rounded-full border transition-all duration-300 ${
              isPortrait ? 'h-6.5 w-6.5' : 'h-5.5 w-5.5'
            } ${
              shortcutsExpanded
                ? 'border-emerald-400/80 bg-emerald-500/30'
                : 'border-white/40 bg-white/10'
            }`}
          >
            <div
              className={`rounded-full transition-all duration-300 ${
                isPortrait ? 'h-2.5 w-2.5' : 'h-2 w-2'
              } ${shortcutsExpanded ? 'bg-emerald-300' : 'bg-white/90 shadow-[0_0_6px_rgba(255,255,255,0.8)]'}`}
            />
          </div>
        </button>
      </div>

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

      {/* Main Controller Overlay: Inward margins (Thumb Comfort Zone away from physical bezel) */}
      <div
        style={{
          paddingLeft: 'max(1.25rem, calc(env(safe-area-inset-left) + 0.5rem))',
          paddingRight: 'max(2.5rem, calc(env(safe-area-inset-right) + 1.25rem))',
          paddingBottom: 'max(2rem, calc(env(safe-area-inset-bottom) + 1rem))',
          opacity,
        }}
        className="pointer-events-none fixed inset-0 z-40 flex select-none flex-col justify-end transition-opacity duration-200"
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
              className={`pointer-events-auto relative flex flex-col ${align === 'start' ? 'items-start' : 'items-end'} gap-2 sm:gap-2.5 touch-none shrink-0`}
              style={{ touchAction: 'none' }}
            >
              {/* Top row: ESC / Menu Button (Preserved per user requirement) */}
              <div className={`relative flex items-center ${align === 'start' ? 'justify-start' : 'justify-end'}`}>
                <button
                  type="button"
                  onPointerDown={(e) => handleButtonPress('menu', e)}
                  onPointerUp={(e) => handleButtonRelease('menu', e)}
                  onPointerCancel={(e) => handleButtonRelease('menu', e)}
                  className={`flex items-center justify-center rounded-full border border-purple-400/40 bg-purple-950/70 text-purple-200 shadow-md backdrop-blur-md transition-transform active:scale-90 ${
                    isPortrait ? (compact ? 'h-8.5 w-8.5' : 'h-9.5 w-9.5') : 'h-8.5 w-8.5'
                  }`}
                  aria-label="菜单"
                  title="菜单 (Esc)"
                >
                  <LuMenu size={isPortrait ? (compact ? 15 : 17) : 15} className="stroke-[2.2]" />
                </button>
              </div>

              {/* Bottom row: Cancel (B/X) and Confirm (A/Z) */}
              <div className="flex items-center gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onPointerDown={(e) => handleButtonPress('cancel', e)}
                  onPointerUp={(e) => handleButtonRelease('cancel', e)}
                  onPointerCancel={(e) => handleButtonRelease('cancel', e)}
                  className={`flex items-center justify-center rounded-full border border-rose-400/50 bg-rose-950/70 text-rose-100 shadow-lg backdrop-blur-md transition-transform active:scale-90 ${
                    isPortrait ? (compact ? 'h-10.5 w-10.5' : 'h-11.5 w-11.5') : 'h-10 w-10'
                  }`}
                  aria-label="取消"
                  title="取消"
                >
                  <LuX size={isPortrait ? (compact ? 17 : 19) : 16} className="stroke-[2.5]" />
                </button>

                <button
                  type="button"
                  onPointerDown={(e) => handleButtonPress('ok', e)}
                  onPointerUp={(e) => handleButtonRelease('ok', e)}
                  onPointerCancel={(e) => handleButtonRelease('ok', e)}
                  className={`flex items-center justify-center rounded-full border-2 border-emerald-400/70 bg-emerald-600/85 text-white shadow-xl shadow-emerald-950/50 backdrop-blur-md transition-transform active:scale-90 ${
                    isPortrait ? (compact ? 'h-13 w-13' : 'h-15 w-15') : 'h-12 w-12'
                  }`}
                  aria-label="确认"
                  title="确认"
                >
                  <LuCheck size={isPortrait ? (compact ? 22 : 25) : 21} className="stroke-[2.8]" />
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
