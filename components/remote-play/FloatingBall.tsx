'use client'

import React, { useEffect, useRef, useState } from 'react'
import { LuSparkles } from 'react-icons/lu'

type FloatingBallProps = {
  onClick: () => void
  disabled?: boolean
  idle?: boolean
}

export function FloatingBall({ onClick, disabled, idle = false }: FloatingBallProps) {
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, initialX: 0, initialY: 0, moved: false })
  const ballRef = useRef<HTMLDivElement>(null)

  // Initialize position to top-right
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPos({
        x: window.innerWidth - 44,
        y: Math.max(60, window.innerHeight * 0.35),
      })
    }
  }, [])

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    setIsDragging(true)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: pos.x,
      initialY: pos.y,
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      dragRef.current.moved = true
    }

    const newX = Math.min(Math.max(6, dragRef.current.initialX + dx), window.innerWidth - 42)
    const newY = Math.min(Math.max(30, dragRef.current.initialY + dy), window.innerHeight - 45)
    setPos({ x: newX, y: newY })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return
    setIsDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }

    if (!dragRef.current.moved) {
      // Tap without dragging
      onClick()
      return
    }

    // Auto snap to closest horizontal edge
    const midX = window.innerWidth / 2
    const targetX = pos.x < midX ? 6 : window.innerWidth - 42
    setPos((prev) => ({ ...prev, x: targetX }))
  }

  return (
    <div
      ref={ballRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        touchAction: 'none',
      }}
      className={`fixed top-0 left-0 z-50 flex h-9 w-9 cursor-pointer select-none items-center justify-center rounded-full border border-emerald-400/50 bg-neutral-900/80 shadow-lg backdrop-blur-md transition-all duration-300 active:scale-95 ${
        isDragging ? 'shadow-emerald-500/30 opacity-100' : idle ? 'opacity-25 hover:opacity-90' : 'opacity-85 hover:opacity-100'
      }`}
      aria-label="打开 Chaya 修改器"
      title="Chaya 悬浮球"
    >
      <div className="flex h-7.5 w-7.5 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-600 to-teal-400 text-white shadow-inner">
        <LuSparkles size={15} className="text-white" />
      </div>
    </div>
  )
}
