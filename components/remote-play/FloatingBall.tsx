'use client'

import React, { useEffect, useRef, useState } from 'react'

type FloatingBallProps = {
  onClick: () => void
  disabled?: boolean
}

export function FloatingBall({ onClick, disabled }: FloatingBallProps) {
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, initialX: 0, initialY: 0, moved: false })
  const ballRef = useRef<HTMLDivElement>(null)

  // Initialize position to top-right
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPos({
        x: window.innerWidth - 64,
        y: Math.max(80, window.innerHeight * 0.35),
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

    const newX = Math.min(Math.max(8, dragRef.current.initialX + dx), window.innerWidth - 60)
    const newY = Math.min(Math.max(40, dragRef.current.initialY + dy), window.innerHeight - 60)
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
    const targetX = pos.x < midX ? 8 : window.innerWidth - 56
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
      className={`fixed top-0 left-0 z-50 flex h-12 w-12 cursor-pointer select-none items-center justify-center rounded-full border border-emerald-400/50 bg-neutral-900/80 shadow-lg backdrop-blur-md transition-shadow active:scale-95 ${
        isDragging ? 'shadow-emerald-500/30' : 'opacity-85 hover:opacity-100'
      }`}
      aria-label="打开 Chaya 修改器"
      title="Chaya 悬浮球"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-600 to-teal-400 text-white shadow-inner">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V17a1 1 0 0 1-2 0v-.07A7.003 7.003 0 0 1 5.07 11H5a1 1 0 0 1 0-2h.07A7.003 7.003 0 0 1 11 3.07V3a1 1 0 0 1 2 0v.07A7.003 7.003 0 0 1 18.93 9H19a1 1 0 0 1 0 2h-.07A7.003 7.003 0 0 1 13 16.93z" />
          <circle cx="12" cy="10" r="2" />
        </svg>
      </div>
    </div>
  )
}
