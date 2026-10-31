'use client'

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'

import { FLOATING_BALL_SIZE } from './floating-ball-layout'
import { clampPosition, type Placement, placementFromFrame, positionFromPlacement, readPlacement, viewport, writePlacement } from './floating-placement'

const SIZE = { width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE }
export const FLOATING_BALL_POSITION_KEY = 'chaya.floatingBall.frame.v1'
const DEFAULT_PLACEMENT: Placement = { version: 2, ...SIZE, x: { mode: 'right', value: 20 }, y: { mode: 'ratio', value: 0.65 } }

export function useFloatingBallPosition(onDragEnd?: () => void) {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [placed, setPlaced] = useState(false)
  const placement = useRef(DEFAULT_PLACEMENT)
  const positionRef = useRef(position)
  const suppressClick = useRef(false)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ pointerId: number; x: number; y: number; origin: typeof position; moved: boolean } | null>(null)

  useEffect(() => {
    placement.current = readPlacement(FLOATING_BALL_POSITION_KEY, DEFAULT_PLACEMENT, 'bottom', false)
    const layout = () => {
      const next = positionFromPlacement(placement.current, SIZE, viewport())
      positionRef.current = next
      setPosition(next)
      setPlaced(true)
    }
    layout()
    window.addEventListener('resize', layout)
    window.visualViewport?.addEventListener('resize', layout)
    window.visualViewport?.addEventListener('scroll', layout)
    return () => {
      window.removeEventListener('resize', layout)
      window.visualViewport?.removeEventListener('resize', layout)
      window.visualViewport?.removeEventListener('scroll', layout)
    }
  }, [])

  function move(next: typeof position) {
    positionRef.current = clampPosition(next, SIZE, viewport())
    placement.current = placementFromFrame({ ...positionRef.current, ...SIZE }, viewport(), 'bottom')
    setPosition(positionRef.current)
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    drag.current = null
    suppressClick.current = current.moved || event.type === 'pointercancel'
    if (current.moved) writePlacement(FLOATING_BALL_POSITION_KEY, placement.current)
    setDragging(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (current.moved) {
      event.currentTarget.blur()
      onDragEnd?.()
    }
  }

  return {
    position,
    placed,
    dragging,
    consumeDragClick() {
      const suppressed = suppressClick.current
      suppressClick.current = false
      return suppressed
    },
    handlers: {
      onPointerDown(event: PointerEvent<HTMLButtonElement>, origin = positionRef.current) {
        if (event.button !== 0 || drag.current) return
        suppressClick.current = false
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin, moved: false }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        event.stopPropagation()
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        const dx = event.clientX - current.x
        const dy = event.clientY - current.y
        if (!current.moved && Math.hypot(dx, dy) < 6) return
        current.moved = true
        setDragging(true)
        move({ x: current.origin.x + dx, y: current.origin.y + dy })
        event.preventDefault()
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        const vectors: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
        const vector = vectors[event.key]
        if (!vector) return
        event.preventDefault()
        const step = event.shiftKey ? 30 : 10
        move({ x: positionRef.current.x + vector[0] * step, y: positionRef.current.y + vector[1] * step })
        writePlacement(FLOATING_BALL_POSITION_KEY, placement.current)
      },
    },
  }
}
