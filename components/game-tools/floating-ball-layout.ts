import { clampPosition, type Viewport } from './floating-placement'

export const FLOATING_BALL_SIZE = 40
export const FLOATING_SHORTCUT_SIZE = FLOATING_BALL_SIZE
export const FLOATING_BALL_FRAME_SIZE = 176
const RADIUS = 64

export function floatingBallLayout(position: { x: number; y: number }, count: number, area: Viewport) {
  const size = Math.max(0, Math.min(FLOATING_BALL_FRAME_SIZE, area.width - 16, area.height - 16))
  const halfBall = FLOATING_BALL_SIZE / 2
  const frame = clampPosition({ x: position.x + halfBall - size / 2, y: position.y + halfBall - size / 2 }, { width: size, height: size }, area)
  return {
    ...frame,
    size,
    scale: size / FLOATING_BALL_FRAME_SIZE,
    center: { x: frame.x + size / 2 - halfBall, y: frame.y + size / 2 - halfBall },
    slots: Array.from({ length: count }, (_, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / count
      const offset = (FLOATING_BALL_FRAME_SIZE - FLOATING_SHORTCUT_SIZE) / 2
      return { x: offset + Math.cos(angle) * RADIUS, y: offset + Math.sin(angle) * RADIUS }
    }),
  }
}
